#!/usr/bin/env python3
"""Apply the CloudFront/IAM hardening steps from AWS-DEPLOY.md step 8.

Dry-run by default: every command prints the change it would make and exits
without touching AWS. Add --apply to commit.

    python3 infra/harden.py status
    python3 infra/harden.py error-pages --apply
    python3 infra/harden.py headers --apply
    python3 infra/harden.py clean-urls --apply

Requires credentials for the AWS account that owns the ai-basics.org
distribution, and boto3. Steps 8c (OIDC) and 8d (Origin Access Control)
are not scripted — infra/README.md explains why.

Every command is idempotent — re-running after a successful apply reports
"already correct" and makes no API call.
"""
import argparse
import json
import pathlib
import sys

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    sys.exit("boto3 not installed — run: pip3 install boto3")

HERE = pathlib.Path(__file__).parent
SITE_ALIAS = "ai-basics.org"
POLICY_NAME = "ai-basics-security-headers"
FUNCTION_NAME = "ai-basics-clean-urls"
ROLE_NAME = "GitHubActionsDeployRole"
GH_REPO = "Reks88/ai-basics-site"

OK, CHANGE, WARN = "  ✓", "  →", "  !"


# ─────────────────────────── helpers ────────────────────────────────────

def cf():
    return boto3.client("cloudfront")


def find_distribution(cfc, explicit=None):
    """Locate the distribution by id, or by its ai-basics.org alias."""
    if explicit:
        return explicit
    paginator = cfc.get_paginator("list_distributions")
    found = []
    for page in paginator.paginate():
        for dist in (page.get("DistributionList") or {}).get("Items") or []:
            aliases = (dist.get("Aliases") or {}).get("Items") or []
            if SITE_ALIAS in aliases:
                return dist["Id"]
            found.append(f"{dist['Id']} ({dist['DomainName']}, aliases={aliases or '-'})")
    if found:
        sys.exit("No distribution carries the alias "
                 f"{SITE_ALIAS}. Visible distributions:\n    "
                 + "\n    ".join(found)
                 + "\n  Pass --distribution-id explicitly if one of these is it.")
    sys.exit("No CloudFront distributions visible to these credentials.\n"
             "  You are almost certainly authenticated to the wrong AWS account —\n"
             "  see infra/README.md.")


def commit(cfc, dist_id, config, etag, apply_):
    if not apply_:
        print(f"{CHANGE} (dry run — pass --apply to commit)")
        return
    cfc.update_distribution(Id=dist_id, DistributionConfig=config, IfMatch=etag)
    print(f"{OK} submitted — CloudFront takes a few minutes to redeploy")


# ─────────────────────────── 8a: error pages ────────────────────────────

WANT_ERRORS = [
    # 403 first: an S3 REST origin returns 403, not 404, for a missing key
    # once the bucket is private (which step 8d does).
    {"ErrorCode": 403, "ResponsePagePath": "/404.html",
     "ResponseCode": "404", "ErrorCachingMinTTL": 300},
    {"ErrorCode": 404, "ResponsePagePath": "/404.html",
     "ResponseCode": "404", "ErrorCachingMinTTL": 300},
]


def cmd_error_pages(args):
    cfc = cf()
    dist_id = find_distribution(cfc, args.distribution_id)
    resp = cfc.get_distribution_config(Id=dist_id)
    config, etag = resp["DistributionConfig"], resp["ETag"]

    current = (config.get("CustomErrorResponses") or {}).get("Items") or []
    print(f"distribution {dist_id}")
    print(f"  current custom error responses: {len(current)}")
    for item in current:
        print(f"    {item['ErrorCode']} -> {item.get('ResponsePagePath')} "
              f"(returns {item.get('ResponseCode')})")

    def key(i):
        return (i["ErrorCode"], i.get("ResponsePagePath"), i.get("ResponseCode"))

    if {key(i) for i in current} >= {key(i) for i in WANT_ERRORS}:
        print(f"{OK} already correct — nothing to do")
        return

    print(f"{CHANGE} set 403 -> /404.html (404) and 404 -> /404.html (404)")
    print("    using response code 404, not 200, so search engines don't "
          "index the error page as real content")
    config["CustomErrorResponses"] = {"Quantity": len(WANT_ERRORS),
                                      "Items": WANT_ERRORS}
    commit(cfc, dist_id, config, etag, args.apply)


# ─────────────────────────── 8b: security headers ───────────────────────

def load_headers_config():
    return json.loads((HERE / "response-headers-policy.json").read_text())


def cmd_headers(args):
    cfc = cf()
    dist_id = find_distribution(cfc, args.distribution_id)
    wanted = load_headers_config()

    # Reuse the policy if a previous run already created it.
    policy_id = None
    for page in cfc.get_paginator("list_response_headers_policies").paginate(
            Type="custom"):
        for item in (page.get("ResponseHeadersPolicyList") or {}).get("Items") or []:
            cfg = item["ResponseHeadersPolicy"]["ResponseHeadersPolicyConfig"]
            if cfg["Name"] == POLICY_NAME:
                policy_id = item["ResponseHeadersPolicy"]["Id"]

    if policy_id:
        print(f"{OK} policy '{POLICY_NAME}' already exists ({policy_id})")
    else:
        print(f"{CHANGE} create response headers policy '{POLICY_NAME}'")
        sec = wanted["SecurityHeadersConfig"]
        print(f"    HSTS            max-age={sec['StrictTransportSecurity']['AccessControlMaxAgeSec']}"
              f" includeSubDomains={sec['StrictTransportSecurity']['IncludeSubdomains']}"
              f" preload={sec['StrictTransportSecurity']['Preload']}")
        print(f"    X-Frame-Options {sec['FrameOptions']['FrameOption']}")
        print(f"    Referrer-Policy {sec['ReferrerPolicy']['ReferrerPolicy']}")
        print("    X-Content-Type-Options nosniff")
        print(f"    CSP             {sec['ContentSecurityPolicy']['ContentSecurityPolicy'][:70]}…")
        if not args.apply:
            print(f"{CHANGE} (dry run — pass --apply to commit)")
            return
        policy_id = cfc.create_response_headers_policy(
            ResponseHeadersPolicyConfig=wanted
        )["ResponseHeadersPolicy"]["Id"]
        print(f"{OK} created {policy_id}")

    # Attach to the default behaviour.
    resp = cfc.get_distribution_config(Id=dist_id)
    config, etag = resp["DistributionConfig"], resp["ETag"]
    behaviour = config["DefaultCacheBehavior"]
    if behaviour.get("ResponseHeadersPolicyId") == policy_id:
        print(f"{OK} already attached to the default behaviour")
        return

    print(f"{CHANGE} attach {policy_id} to the default cache behaviour of {dist_id}")
    behaviour["ResponseHeadersPolicyId"] = policy_id
    commit(cfc, dist_id, config, etag, args.apply)


# ─────────────────────────── 8e: clean URLs ─────────────────────────────

def cmd_clean_urls(args):
    cfc = cf()
    dist_id = find_distribution(cfc, args.distribution_id)
    code = (HERE / "clean-urls.js").read_bytes()

    try:
        existing = cfc.describe_function(Name=FUNCTION_NAME)
        arn = existing["FunctionSummary"]["FunctionMetadata"]["FunctionARN"]
        stage = existing["FunctionSummary"]["FunctionMetadata"]["Stage"]
        print(f"{OK} function '{FUNCTION_NAME}' exists ({stage})")
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "NoSuchFunctionExists":
            raise
        print(f"{CHANGE} create and publish CloudFront Function '{FUNCTION_NAME}'")
        print("    rewrites /glossary -> /glossary.html on viewer request")
        if not args.apply:
            print(f"{CHANGE} (dry run — pass --apply to commit)")
            return
        created = cfc.create_function(
            Name=FUNCTION_NAME,
            FunctionConfig={"Comment": "Append .html to extensionless paths",
                            "Runtime": "cloudfront-js-2.0"},
            FunctionCode=code)
        arn = created["FunctionSummary"]["FunctionMetadata"]["FunctionARN"]
        cfc.publish_function(Name=FUNCTION_NAME, IfMatch=created["ETag"])
        print(f"{OK} published {arn}")

    resp = cfc.get_distribution_config(Id=dist_id)
    config, etag = resp["DistributionConfig"], resp["ETag"]
    behaviour = config["DefaultCacheBehavior"]
    assoc = (behaviour.get("FunctionAssociations") or {}).get("Items") or []
    if any(a.get("FunctionARN") == arn and a.get("EventType") == "viewer-request"
           for a in assoc):
        print(f"{OK} already associated with viewer-request")
        return

    print(f"{CHANGE} associate function with viewer-request on {dist_id}")
    assoc = [a for a in assoc if a.get("EventType") != "viewer-request"]
    assoc.append({"FunctionARN": arn, "EventType": "viewer-request"})
    behaviour["FunctionAssociations"] = {"Quantity": len(assoc), "Items": assoc}
    commit(cfc, dist_id, config, etag, args.apply)


# ─────────────────────────── status ─────────────────────────────────────

def cmd_status(args):
    cfc = cf()
    dist_id = find_distribution(cfc, args.distribution_id)
    resp = cfc.get_distribution_config(Id=dist_id)
    config = resp["DistributionConfig"]
    behaviour = config["DefaultCacheBehavior"]
    origin = config["Origins"]["Items"][0]

    print(f"distribution {dist_id}")
    print(f"  aliases        {(config.get('Aliases') or {}).get('Items') or '-'}")
    print(f"  origin         {origin['DomainName']}")
    print(f"  origin type    "
          f"{'S3 website endpoint' if 's3-website' in origin['DomainName'] else 'S3 REST / other'}")
    oac = origin.get("OriginAccessControlId")
    print(f"  8d OAC         {oac or 'NOT SET (bucket likely world-readable)'}")

    errs = (config.get("CustomErrorResponses") or {}).get("Items") or []
    summary = [f"{e['ErrorCode']}->{e.get('ResponsePagePath')}" for e in errs]
    print(f"  8a error pages {summary or 'NOT SET'}")
    print(f"  8b headers     {behaviour.get('ResponseHeadersPolicyId') or 'NOT SET'}")
    assoc = (behaviour.get("FunctionAssociations") or {}).get("Items") or []
    print(f"  8e clean urls  {[a['EventType'] for a in assoc] if assoc else 'NOT SET'}")


# ─────────────────────────── cli ────────────────────────────────────────

COMMANDS = {
    "status": cmd_status,
    "error-pages": cmd_error_pages,
    "headers": cmd_headers,
    "clean-urls": cmd_clean_urls,
}
# Step 8c (OIDC deploy role) and 8d (Origin Access Control) are deliberately
# not scripted here — see infra/README.md for why and how to do them.


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=sorted(COMMANDS))
    ap.add_argument("--apply", action="store_true",
                    help="actually make the change (default is dry run)")
    ap.add_argument("--distribution-id",
                    help=f"skip auto-discovery by the {SITE_ALIAS} alias")
    args = ap.parse_args()

    if not args.apply:
        print("DRY RUN — no changes will be made. Add --apply to commit.\n")
    COMMANDS[args.command](args)


if __name__ == "__main__":
    main()

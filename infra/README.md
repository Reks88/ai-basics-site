# infra — CloudFront hardening

Scripted versions of the console steps in `AWS-DEPLOY.md` step 8, so they're
reviewable in a diff instead of clicked through a UI.

## Prerequisite: the right AWS account

`harden.py` must run with credentials for **the account that owns the
ai-basics.org CloudFront distribution** (`d35gjncy3cc0uh.cloudfront.net`).

Check what you're authenticated as first:

```bash
aws sts get-caller-identity
aws cloudfront list-distributions --query 'DistributionList.Quantity'
```

If that second command prints `None` or `0`, you're in the wrong account and
every command here will refuse to run. A Workhuman SSO profile will *not*
work — the site is in a personal account.

```bash
aws configure --profile ai-basics      # or: aws configure sso --profile ai-basics
export AWS_PROFILE=ai-basics
```

## Usage

Everything is **dry run by default** — it prints the change and exits. Add
`--apply` to commit. All commands are idempotent: re-running after a
successful apply reports "already correct" and makes no API call.

```bash
python3 infra/harden.py status                 # what's configured right now
python3 infra/harden.py error-pages            # preview 8a
python3 infra/harden.py error-pages --apply    # commit 8a
python3 infra/harden.py headers --apply        # 8b
python3 infra/harden.py clean-urls --apply     # 8e
```

Run them in that order. Each CloudFront change takes a few minutes to
redeploy globally; `status` will show it once live.

### Verifying afterwards

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ai-basics.org/no-such-page   # expect 404
curl -sI https://ai-basics.org/ | grep -iE 'strict-transport|content-security|x-frame'
curl -s -o /dev/null -w '%{http_code}\n' https://ai-basics.org/glossary        # expect 200
```

## What each step does

| Step | Command | Effect |
|---|---|---|
| 8a | `error-pages` | 403 and 404 both serve `/404.html` with a real 404 status. **Without this `404.html` is never shown** — a bad URL returns raw S3 `NoSuchKey` XML. |
| 8b | `headers` | Attaches a response-headers policy: HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`. The site currently sends none of these. |
| 8e | `clean-urls` | A CloudFront Function appending `.html` to extensionless paths, so `/glossary` works, not just `/glossary.html`. |

### Notes on the choices

- **HSTS `preload` is deliberately `false`.** Submitting a domain to the
  preload list is effectively irreversible — it ships in browser binaries and
  removal takes months. `max-age=31536000` with `includeSubDomains` gives you
  nearly all the benefit and stays reversible. Flip it in
  `response-headers-policy.json` only if you're certain the apex and every
  subdomain will be HTTPS-only forever.
- **The CSP carries `'unsafe-inline'`** for both `style-src` and `script-src`,
  because every page's CSS and JS is inline. That weakens the CSP's
  XSS protection considerably — it's still worth shipping for the other
  directives (`object-src 'none'`, `frame-ancestors 'none'`, `base-uri`), but
  the real win comes from moving inline blocks into files, or adding
  per-build nonces, and then dropping `'unsafe-inline'`.
- **`error-pages` sets the response code to 404, not 200.** Returning 200 for
  a missing page is a "soft 404": search engines treat the error page as real
  content and index it.
- **`clean-urls` only appends `.html` when the last path segment has no dot**,
  so `/og-cover.png` and `/sitemap.xml` pass through untouched.

## Not scripted, and why

### 8c — OIDC instead of long-lived IAM keys

`deploy.yml` authenticates with `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` repo secrets. Those are standing credentials for a
now-public repo; an OIDC role issues short-lived ones per run instead.

Not scripted because the last step — deleting the two repo secrets — needs
GitHub repo admin rather than AWS, so the migration can't complete
unattended. Doing it by hand:

1. **IAM → Identity providers → Add provider → OpenID Connect**
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. **IAM → Roles → Create role → Web identity**, select that provider and
   audience. Then edit the trust relationship to restrict it to this repo's
   `main` branch — condition `token.actions.githubusercontent.com:sub` equals
   `repo:Reks88/ai-basics-site:ref:refs/heads/main`. Without that condition
   *any* GitHub repo can assume the role.
3. Attach a least-privilege policy: `s3:ListBucket` on the bucket,
   `s3:PutObject` + `s3:DeleteObject` on `bucket/*`, and
   `cloudfront:CreateInvalidation` on the distribution.
4. In `.github/workflows/deploy.yml`, uncomment the OIDC block, set
   `role-to-assume` to the new role ARN, and delete the access-key step.
5. **GitHub → Settings → Secrets and variables → Actions** — delete
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

### 8d — Origin Access Control

`bucket-policy.json` grants `s3:GetObject` to `Principal: "*"`, so the bucket
is readable directly, bypassing CloudFront entirely. OAC makes the bucket
private and lets only the distribution read it.

Not scripted because it's the one change that can take the site down: it
swaps the origin from the S3 *website* endpoint to the S3 *REST* endpoint,
and if the bucket policy and the OAC aren't in place before public access is
blocked, every request 403s. The ordering also interacts with 8a — a REST
origin returns 403 rather than 404 for a missing key, which is why
`error-pages` configures both codes.

Do it in this order, checking the site between each step:

1. Create an OAC (**CloudFront → Origin access → Create control setting**).
2. Point the distribution's origin at the bucket's REST endpoint
   (`bucket.s3.region.amazonaws.com`) and attach the OAC. Let the console
   update the bucket policy for you.
3. Confirm the site still loads, including a deep link like
   `/chapter3.html`.
4. Only now re-enable **Block all public access** on the bucket and remove
   the `Principal: "*"` statement.
5. Re-check the site, and that a bad URL still returns `/404.html`.

Note that a REST origin has no index-document behaviour, so directory-style
paths stop resolving — `clean-urls` (8e) covers that, which is another reason
to apply 8e first.

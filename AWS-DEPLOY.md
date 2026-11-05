# Hosting AI Basics on AWS S3

## What you'll need
- An AWS account
- Your 7 HTML files + `shared.css` ready to upload
- The `bucket-policy.json` file in this folder

---

## Step 1 — Create the S3 Bucket

1. Go to **AWS Console → S3 → Create bucket**
2. **Bucket name**: pick a globally unique name, e.g. `ai-basics-site` (lowercase, no spaces)
3. **Region**: pick one close to you — `ap-southeast-1` (Singapore) or `us-east-1` (Virginia)
4. **Block Public Access settings**: uncheck **"Block all public access"** → tick the acknowledgement checkbox
5. Leave everything else as default → click **Create bucket**

---

## Step 2 — Enable Static Website Hosting

1. Click your bucket → go to the **Properties** tab
2. Scroll to the very bottom → **Static website hosting → Edit**
3. Select **Enable**
4. **Index document**: `index.html`
5. **Error document**: `index.html`
6. Click **Save changes**
7. Copy the **Bucket website endpoint** URL shown — this is your site URL

---

## Step 3 — Apply the Bucket Policy

1. Go to the **Permissions** tab of your bucket
2. Scroll to **Bucket policy → Edit**
3. Paste the JSON below, replacing `YOUR-BUCKET-NAME` with your actual bucket name:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

4. Click **Save changes**

> The `bucket-policy.json` file in this folder has this ready — just swap the bucket name.

---

## Step 4 — Upload Your Files

1. Go to the **Objects** tab → click **Upload**
2. Click **Add files** → select all these files:
   - `index.html`
   - `chapter1.html` … `chapter7.html` (all seven)
   - `quiz.html`
   - `glossary.html`
   - `404.html`
   - `shared.css`
   - `robots.txt`, `sitemap.xml`
   - `og-cover.png`, `favicon.ico`, `apple-touch-icon.png`
3. Click **Upload**

> Do **not** upload `bucket-policy.json`, `AWS-DEPLOY.md`, or anything under `.claude/`.
> In practice the GitHub Actions workflow (`.github/workflows/deploy.yml`) does all
> of this on every push to `main` — manual upload is only for the first run.

---

## Step 5 — Visit Your Site

Open the **Bucket website endpoint** URL from Step 2. Your site is live 🎉

It will look like:
```
http://ai-basics-site.s3-website-ap-southeast-1.amazonaws.com
```

---

## Step 6 (Recommended) — Add CloudFront for HTTPS

The S3 URL is HTTP only. Google Fonts won't load reliably without HTTPS, and browsers may show security warnings.

1. Go to **CloudFront → Create distribution**
2. **Origin domain**: paste the S3 **website endpoint** from Step 2 (not the REST endpoint — it should start with `http://`, not `s3.amazonaws.com`)
3. **Viewer protocol policy**: Redirect HTTP to HTTPS
4. **Default root object**: `index.html`
5. Click **Create distribution** — takes ~5 minutes to deploy globally
6. Your HTTPS URL will be: `https://xxxxxx.cloudfront.net`

---

## Step 7 (Optional) — Custom Domain

If you want a proper URL like `aibasics.io`:

1. Register the domain in **Route 53** (~$12/year for `.com`)
2. In CloudFront → your distribution → **Alternate domain names (CNAMEs)**: add your domain
3. Click **Request certificate** → use **AWS Certificate Manager (ACM)** in `us-east-1` — it's free
4. Validate via DNS (ACM will show you a CNAME record to add to Route 53 — one click)
5. In **Route 53 → Hosted zone → Create record**:
   - Record type: **A**
   - Toggle **Alias** on
   - Route traffic to: **Alias to CloudFront distribution** → select yours
6. DNS propagates in ~5 minutes

---

## Step 8 — Post-setup hardening

These are console-side changes the repo can't make for itself. The first one is
**required** for `404.html` to ever be shown.

> **Steps 8a, 8b and 8e are scripted** — see [`infra/README.md`](infra/README.md).
> `python3 infra/harden.py status` shows what's configured; each command is dry-run
> by default and idempotent. 8c and 8d stay manual, for reasons explained there.
> The steps below describe the equivalent clicks if you'd rather use the console.

### 8a. Serve the custom 404 page (required)

Without this, a bad URL returns raw S3 XML (`Code: NoSuchKey`), which looks broken.

**CloudFront → your distribution → Error pages → Create custom error response**, twice:

| HTTP error code | Customize response | Response page path | HTTP response code |
|---|---|---|---|
| 403 Forbidden | Yes | `/404.html` | 404 |
| 404 Not Found | Yes | `/404.html` | 404 |

Use `404` as the response code, not `200` — returning 200 for a missing page tells
search engines the error page is real content ("soft 404") and gets it indexed.

> 403 is listed because an S3 **REST** origin returns 403, not 404, for a missing
> key when the bucket isn't public. Covering both is harmless.

### 8b. Add security response headers

The site currently sends no `Strict-Transport-Security`, `Content-Security-Policy`,
`X-Content-Type-Options` or `Referrer-Policy`.

**CloudFront → Policies → Response headers → Create policy**, then attach it to the
default behaviour. A good starting point for this site:

- **HSTS**: max-age 31536000, include subdomains, preload
- **X-Content-Type-Options**: `nosniff`
- **Referrer-Policy**: `strict-origin-when-cross-origin`
- **X-Frame-Options**: `DENY`
- **Content-Security-Policy**:
  ```
  default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self' 'unsafe-inline';
  object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  ```
  `'unsafe-inline'` is needed because every page's CSS and JS is inline. Dropping it
  later means moving those to files or adding per-build nonces.

### 8c. Replace IAM access keys with OIDC

`deploy.yml` currently authenticates with `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` secrets — long-lived credentials sitting in a now-public
repo's settings. The workflow already contains a commented-out OIDC block: create an
IAM role trusting `token.actions.githubusercontent.com` (scoped to
`repo:Reks88/ai-basics-site:ref:refs/heads/main`), then swap to it and delete both
secrets.

### 8d. Lock the bucket down with Origin Access Control

`bucket-policy.json` grants `s3:GetObject` to `Principal: "*"`, so the bucket is
readable by anyone directly, bypassing CloudFront. The current pattern is **Origin
Access Control**: in CloudFront set the origin to the S3 **REST** endpoint, create an
OAC, and let the console update the bucket policy to allow only that distribution.
Then re-enable *Block all public access* on the bucket. (Note this changes the origin
type from Step 6, and makes 8a's 403 rule necessary.)

### 8e. Optional — clean URLs

`/glossary` 404s today; only `/glossary.html` works. A CloudFront Function on
*viewer request* that appends `.html` to extensionless paths gives you tidier,
more linkable URLs without renaming anything.

---

## Cost Estimate

| Service | Cost |
|---|---|
| S3 storage (8 tiny files) | < $0.01 / month |
| S3 requests | < $0.01 / month |
| CloudFront (first 1TB free) | $0 on free tier |
| Route 53 hosted zone | $0.50 / month |
| Domain (`.com`) | ~$12 / year |
| **Total (with domain)** | **~$18 / year** |

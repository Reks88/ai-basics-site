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
   - `chapter1.html`
   - `chapter2.html`
   - `chapter3.html`
   - `chapter4.html`
   - `chapter5.html`
   - `quiz.html`
   - `shared.css`
3. Click **Upload**

> Do **not** upload `bucket-policy.json` or `AWS-DEPLOY.md`.

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

## Cost Estimate

| Service | Cost |
|---|---|
| S3 storage (8 tiny files) | < $0.01 / month |
| S3 requests | < $0.01 / month |
| CloudFront (first 1TB free) | $0 on free tier |
| Route 53 hosted zone | $0.50 / month |
| Domain (`.com`) | ~$12 / year |
| **Total (with domain)** | **~$18 / year** |

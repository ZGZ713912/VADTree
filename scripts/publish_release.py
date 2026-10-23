#!/usr/bin/env python3
"""Publish the bundles listed in MANIFEST.json as GitHub Release assets.

The token is read from $GH_TOKEN / $GITHUB_TOKEN, falling back to the local git
credential helper, and is never echoed. Assets are uploaded one by one; an asset
that already exists with the same size is skipped, so re-running is safe.

Usage:
    python scripts/publish_release.py --draft     # upload, tag created on publish
    python scripts/publish_release.py             # publish immediately
    python scripts/publish_release.py --release   # flip an existing draft to public
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.github.com"
UA = "vadtree-publish/1.0"


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return ("%d B" % n) if unit == "B" else ("%.1f %s" % (n, unit))
        n /= 1024.0


def token():
    for var in ("GH_TOKEN", "GITHUB_TOKEN"):
        value = os.environ.get(var)
        if value:
            return value.strip()
    try:
        out = subprocess.run(
            ["git", "credential", "fill"],
            input="protocol=https\nhost=github.com\n\n",
            capture_output=True, text=True, timeout=15).stdout
        for line in out.splitlines():
            if line.startswith("password="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    sys.exit("no GitHub token: set GH_TOKEN or configure the git credential helper")


def call(method, url, tok, payload=None, data=None, ctype="application/json"):
    body = None
    if payload is not None:
        body = json.dumps(payload).encode()
    elif data is not None:
        body = data
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", "token " + tok)
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/vnd.github+json")
    if body is not None:
        req.add_header("Content-Type", ctype)
    with urllib.request.urlopen(req, timeout=300) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else {}


def find_release(repo, tag, tok):
    for rel in call("GET", "%s/repos/%s/releases" % (API, repo), tok):
        if rel["tag_name"] == tag:
            return rel
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--draft", action="store_true",
                    help="create the release as a draft (no tag until published)")
    ap.add_argument("--release", action="store_true",
                    help="publish an existing draft release")
    ap.add_argument("--notes", default="", help="extra release notes")
    args = ap.parse_args()

    with open(os.path.join(REPO_ROOT, "MANIFEST.json")) as f:
        manifest = json.load(f)
    repo = manifest["repo"]
    tag = manifest["release_tag"]
    tok = token()

    existing = find_release(repo, tag, tok)
    if args.release:
        if not existing:
            sys.exit("no release %s to publish" % tag)
        call("PATCH", "%s/repos/%s/releases/%s" % (API, repo, existing["id"]),
             tok, {"draft": False})
        print("published %s" % existing["html_url"])
        return 0

    body = args.notes or "\n".join(
        "- **%s** (%s): %s" % (b["name"], human(b["bytes"]), b["description"])
        for b in manifest["bundles"])
    body += ("\n\nRestore with `python scripts/fetch_artifacts.py`. "
             "Checksums for every file live in `MANIFEST.json`.")

    if existing:
        release = existing
        print("reusing release %s (%d assets)" % (tag, len(release.get("assets", []))))
    else:
        release = call("POST", "%s/repos/%s/releases" % (API, repo), tok, {
            "tag_name": tag,
            "target_commitish": "main",
            "name": "Experiment artifacts %s" % tag,
            "body": body,
            "draft": args.draft,
            "prerelease": False,
        })
        print("created release %s (draft=%s)" % (release["html_url"], args.draft))

    existing_assets = {a["name"]: a for a in release.get("assets", [])}
    uploaded = 0
    for bundle in manifest["bundles"]:
        asset = bundle["asset"]
        path = os.path.join(REPO_ROOT, "dist", asset)
        if not os.path.exists(path):
            print("  missing locally: %s (run package_artifacts.py)" % asset)
            continue
        current = existing_assets.get(asset)
        if current and current["size"] == bundle["bytes"]:
            print("  skip    %-34s already uploaded" % asset)
            continue
        with open(path, "rb") as f:
            data = f.read()
        url = "%s/repos/%s/releases/%s/assets?name=%s" % (
            "https://uploads.github.com", repo, release["id"], asset)
        try:
            call("POST", url, tok, data=data, ctype="application/gzip")
        except urllib.error.HTTPError as e:
            print("  FAILED  %-34s HTTP %s" % (asset, e.code))
            continue
        print("  upload  %-34s %s" % (asset, human(bundle["bytes"])))
        uploaded += 1

    release = find_release(repo, tag, tok)
    print("\n%d uploaded, %d assets total"
          % (uploaded, len(release.get("assets", []))))
    print("url: %s" % release["html_url"])
    if release["draft"]:
        print("draft -> publish with: python scripts/publish_release.py --release")
    return 0


if __name__ == "__main__":
    sys.exit(main())

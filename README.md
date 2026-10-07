# Cornell Club of Delhi website

Static site in `site/`, published to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.

## Updating content

Go to `/admin` on the live site and log in with the shared admin password. From there you can:

- edit the home page text and the footer description
- add, edit and delete events (each with its own RSVP link)
- publish community posts with a photo
- manage the committee list
- set the club email, social links and footer links

Each save commits to this repository; the live site updates about a minute later.
Anything left blank (email, social links, RSVP links) stays hidden, so visitors never see a link that goes nowhere.

Content lives in `site/content/` (`site.json`, `events.json`, `posts.json`, photos in `uploads/`).

## Admin access

The first visit to `/admin` runs a one-time setup. It needs a **fine-grained GitHub token** with access to
this repository only and **Contents: Read and write**, plus a shared password of at least 12 characters.
The token is encrypted in the browser with that password (PBKDF2-SHA256, 600k iterations → AES-GCM) and saved
as `site/admin/auth.json`. Use a long passphrase: the encrypted file is public.
Change the password or replace an expiring token under **Settings** in the admin.

## Loading animation

`site/assets/ccd-skyline-loader.svg` (preview: `site/loading-state.html`) is generated:

    python3 tools/build_skyline.py "Cornell Logo source image/cornell_seal_simple_web_black.svg" site

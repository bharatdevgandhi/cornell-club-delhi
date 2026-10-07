// One-time admin setup from the command line.
//
// Reads a fine-grained GitHub token from the macOS clipboard (never printed),
// checks it can write to the repo, encrypts it with the shared admin password
// exactly as site/admin/admin.js expects (PBKDF2-SHA256 600k → AES-GCM), and
// writes site/admin/auth.json. Commit and push that file to finish.
//
// Usage: node tools/admin_setup.js <owner> <repo> <password>
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [owner, repo, password] = process.argv.slice(2);
if (!owner || !repo || !password) {
  console.error('Usage: node tools/admin_setup.js <owner> <repo> <password>');
  process.exit(1);
}

const token = execFileSync('pbpaste').toString().trim();
if (!/^github_pat_[A-Za-z0-9_]+$/.test(token)) {
  console.error('The clipboard does not contain a fine-grained GitHub token (github_pat_…). Copy it again and rerun.');
  process.exit(1);
}

(async () => {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (!r.ok) { console.error(`GitHub rejected the token for ${owner}/${repo} (HTTP ${r.status}).`); process.exit(1); }
  const info = await r.json();
  if (!info.permissions || !info.permissions.push) {
    console.error('The token can read the repo but cannot write to it. It needs Contents: Read and write.');
    process.exit(1);
  }

  const iterations = 600000;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  // WebCrypto's AES-GCM output is ciphertext followed by the 16-byte tag.
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final(), cipher.getAuthTag()]);

  const record = {
    version: 1, owner, repo, branch: 'main', root: 'site/',
    token: { kdf: 'PBKDF2-SHA256', iterations, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') }
  };
  const out = path.join(__dirname, '..', 'site', 'admin', 'auth.json');
  fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
  console.log(`Token verified (write access to ${owner}/${repo}) and encrypted into site/admin/auth.json.`);
})();

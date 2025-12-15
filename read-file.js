import fs from 'fs';
import git from 'isomorphic-git';
import path from 'path';

// Parse arguments
const repoPath = process.argv[2];
const refName = process.argv[3];   // e.g. "main"
const filePath = process.argv[4];  // e.g. "src/config.json"

if (!repoPath || !refName || !filePath) {
  console.error("Usage: node read-file.js <repo> <ref> <path>");
  process.exit(1);
}

const gitdir = path.resolve(repoPath);

// --- HELPER: Walk to the target Blob ---
async function resolveBlobEntry(dir, rootTreeSha, targetPath) {
  const parts = targetPath.replace(/^\/+|\/+$/g, '').split('/');
  let currentSha = rootTreeSha;
  let mode = null;
  let type = 'tree';

  // Walk through the folders
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLastPart = (i === parts.length - 1);

    // If we are trying to traverse INSIDE a file, error out
    if (type !== 'tree') {
       throw new Error(`Path segment '${parts[i-1]}' is a file, not a directory.`);
    }

    // Read the current tree
    const result = await git.readTree({ fs, gitdir: dir, oid: currentSha });
    const entry = result.tree.find(e => e.path === part);

    if (!entry) {
      throw new Error(`Path '${targetPath}' not found (missing '${part}').`);
    }

    currentSha = entry.oid;
    type = entry.type;
    mode = entry.mode;
  }

  return { sha: currentSha, mode, type };
}

// --- HELPER: Detect Binary (Simple Heuristic) ---
function isBinary(buffer) {
  // Check start of buffer for null bytes (common in images/binaries)
  // or just if it's not valid UTF-8? 
  // A simple check is looking for null bytes in the first 8000 chars.
  const chunk = buffer.slice(0, 8000);
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === 0) return true;
  }
  return false;
}

async function main() {
  try {
    // --- STEP 1: Resolve the Commit ---
    let commitSha;
    try {
      commitSha = await git.resolveRef({ fs, gitdir, ref: refName });
    } catch (e) {
      throw new Error(`Ref '${refName}' not found.`);
    }

    // --- STEP 2: Get Root Tree ---
    const commit = await git.readCommit({ fs, gitdir, oid: commitSha });
    const rootTreeSha = commit.commit.tree;

    // --- STEP 3: Find the File ---
    const target = await resolveBlobEntry(gitdir, rootTreeSha, filePath);

    // --- STEP 4: Validation ---
    if (target.type !== 'blob') {
      throw new Error(`Path '${filePath}' points to a ${target.type}, not a file.`);
    }

    // You mentioned specifically checking for 100644 (standard file)
    // 100755 is an executable file (script).
    if (target.mode !== '100644' && target.mode !== '100755') {
       console.warn(`Warning: File mode is ${target.mode} (not standard 100644)`);
    }

    // --- STEP 5: Read Content ---
    const { blob } = await git.readBlob({
      fs,
      gitdir,
      oid: target.sha
    });

    // --- STEP 6: Output ---
    if (isBinary(blob)) {
      console.log(`[Binary File Detected] (SHA: ${target.sha.slice(0,7)}, Size: ${blob.length} bytes)`);
      console.log("(Content suppressed)");
    } else {
      // Assuming UTF-8 text
      const content = Buffer.from(blob).toString('utf8');
      console.log(content);
    }

  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
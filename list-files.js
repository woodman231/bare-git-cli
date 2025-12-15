import fs from 'fs';
import git from 'isomorphic-git';
import path from 'path';

// Parse arguments
const repoPath = process.argv[2];
const refName = process.argv[3] || 'HEAD'; // Default to HEAD
const folderPath = process.argv[4] || '';  // Default to root

if (!repoPath) {
  console.error("Usage: node list-files.js <repo> [ref] [folder-path]");
  process.exit(1);
}

const gitdir = path.resolve(repoPath);

// --- HELPER: Walk to the target tree ---
// Given a root tree SHA and a path string (e.g. "src/models"),
// this finds the SHA of the "models" tree.
async function resolveTreeSha(dir, rootTreeSha, targetPath) {
  if (!targetPath || targetPath === '.' || targetPath === '/') {
    return { sha: rootTreeSha, type: 'tree' };
  }

  const parts = targetPath.replace(/^\/+|\/+$/g, '').split('/');
  let currentSha = rootTreeSha;
  let type = 'tree';

  for (const part of parts) {
    if (type !== 'tree') {
      throw new Error(`Path '${part}' is inside a file, not a directory.`);
    }

    const result = await git.readTree({ fs, gitdir: dir, oid: currentSha });
    const entry = result.tree.find(e => e.path === part);

    if (!entry) {
      throw new Error(`Path '${targetPath}' not found.`);
    }

    currentSha = entry.oid;
    type = entry.type;
  }

  return { sha: currentSha, type };
}

async function main() {
  try {
    console.log(`Open Repo: ${gitdir}`);
    console.log(`Ref:       ${refName}`);
    console.log(`Path:      ${folderPath || '(root)'}\n`);

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

    // --- STEP 3: Navigate to Target Folder ---
    const target = await resolveTreeSha(gitdir, rootTreeSha, folderPath);

    // Edge Case: If the user asked for a file path, just show that file info
    if (target.type === 'blob') {
       console.log(`(Item is a file, SHA: ${target.sha.slice(0,7)})`);
       return;
    }

    // --- STEP 4: List Contents ---
    const result = await git.readTree({ fs, gitdir, oid: target.sha });
    const entries = result.tree;

    console.log(`Mode      Type    SHA       Name`);
    console.log(`----------------------------------------`);

    for (const entry of entries) {
      const typeStr = entry.type.padEnd(7);
      const shaStr = entry.oid.slice(0, 7);
      
      // Add a slash to directories for visual clarity
      const nameStr = entry.type === 'tree' ? `${entry.path}/` : entry.path;
      
      console.log(`${entry.mode}    ${typeStr} ${shaStr}   ${nameStr}`);
    }

  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
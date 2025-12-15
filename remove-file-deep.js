import fs from 'fs';
import git from 'isomorphic-git';
import path from 'path';

// Parse arguments
const repoPath = process.argv[2];
const refName = process.argv[3];   // e.g., "main"
const filePath = process.argv[4];  // e.g., "src/models/user.js"

if (!repoPath || !refName || !filePath) {
  console.error("Usage: node remove-file-deep.js <repo> <ref> <path>");
  process.exit(1);
}

const gitdir = path.resolve(repoPath);

// --- HELPER: Recursive Tree Pruning ---
// Returns:
//   - A SHA string: The new tree SHA (content changed)
//   - NULL: The tree became empty (should be deleted)
//   - Throws error: If path doesn't exist
async function removeTreeEntry(dir, treeSha, pathParts) {
  const [currentPart, ...remainingParts] = pathParts;

  // 1. Read existing tree
  const result = await git.readTree({ fs, gitdir: dir, oid: treeSha });
  const entries = result.tree;

  // 2. Find the target entry
  const entryIndex = entries.findIndex(e => e.path === currentPart);
  
  if (entryIndex === -1) {
    throw new Error(`Path segment '${currentPart}' not found in tree ${treeSha.slice(0,7)}`);
  }

  // 3. Determine action
  if (remainingParts.length === 0) {
    // BASE CASE: We found the file to remove. Delete it from the list.
    entries.splice(entryIndex, 1);
  } else {
    // RECURSIVE STEP: We are in a parent folder.
    const entry = entries[entryIndex];
    if (entry.type !== 'tree') throw new Error(`${currentPart} is not a directory.`);

    // Go deeper
    const newSubTreeSha = await removeTreeEntry(dir, entry.oid, remainingParts);

    if (newSubTreeSha === null) {
      // The child folder became empty -> Remove it entirely!
      entries.splice(entryIndex, 1);
    } else {
      // The child folder changed -> Update our pointer to it
      entries[entryIndex].oid = newSubTreeSha;
    }
  }

  // 4. Final check for THIS folder
  if (entries.length === 0) {
    return null; // This folder is now empty, signal parent to remove it
  }

  // 5. Write the modified tree
  return await git.writeTree({
    fs,
    gitdir: dir,
    tree: entries
  });
}


async function main() {
  try {
    console.log(`Open Repo: ${gitdir}`);

    // --- STEP 1: Resolve Parent Commit ---
    let parentSha;
    try {
      parentSha = await git.resolveRef({ fs, gitdir, ref: refName });
      console.log(`Parent Commit (${refName}): ${parentSha.slice(0, 7)}`);
    } catch (e) {
      throw new Error(`Ref ${refName} does not exist. Cannot remove file.`);
    }

    // --- STEP 2: Get Root Tree ---
    const commit = await git.readCommit({ fs, gitdir, oid: parentSha });
    const rootTreeSha = commit.commit.tree;

    // --- STEP 3: Recursive Removal ---
    const pathParts = filePath.replace(/^\/+/, '').split('/'); // clean path
    let newRootTreeSha;
    
    try {
        newRootTreeSha = await removeTreeEntry(gitdir, rootTreeSha, pathParts);
    } catch (e) {
        console.error("Remove failed:", e.message);
        process.exit(1);
    }

    // Handle edge case: Did we delete the very last file in the repo?
    if (newRootTreeSha === null) {
        console.log("Repo is now empty. Writing empty root tree.");
        newRootTreeSha = await git.writeTree({ fs, gitdir, tree: [] });
    }

    console.log(`New Root Tree: ${newRootTreeSha.slice(0, 7)}`);

    // --- STEP 4: Create Commit ---
    const author = {
      name: 'API Bot',
      email: 'bot@example.com',
      timestamp: Math.floor(Date.now() / 1000),
      timezoneOffset: 0
    };

    const commitSha = await git.writeCommit({
      fs,
      gitdir,
      commit: {
        message: `Remove ${filePath}`,
        tree: newRootTreeSha,
        parent: [parentSha],
        author: author,
        committer: author
      }
    });

    // --- STEP 5: Update Ref (Manual Compare-and-Swap) ---
    const currentSha = await git.resolveRef({ fs, gitdir, ref: refName });

    if (currentSha !== parentSha) {
       throw new Error(`Concurrency Error: ${refName} moved from ${parentSha} to ${currentSha}`);
    }

    await git.writeRef({
      fs,
      gitdir,
      ref: `refs/heads/${refName.replace('refs/heads/', '')}`,
      value: commitSha,
      force: true 
    });

    console.log(`Success! Removed ${filePath}. New Commit: ${commitSha.slice(0,7)}`);

  } catch (err) {
    console.error("Error:", err);
  }
}

main();
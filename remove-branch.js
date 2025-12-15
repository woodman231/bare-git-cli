import fs from 'fs';
import git from 'isomorphic-git';
import path from 'path';

// Parse arguments
const repoPath = process.argv[2];
const branchName = process.argv[3];

if (!repoPath || !branchName) {
  console.error("Usage: node remove-branch.js <repo> <branch-name>");
  process.exit(1);
}

const gitdir = path.resolve(repoPath);

async function main() {
  try {
    console.log(`Open Repo: ${gitdir}`);

    // --- STEP 1: Normalize the Ref Name ---
    // Users might type "main" or "refs/heads/main". We handle both.
    const fullRef = branchName.startsWith('refs/heads/') 
      ? branchName 
      : `refs/heads/${branchName}`;

    // --- STEP 2: Check if it exists (Optional but good UX) ---
    // deleteRef doesn't always throw if the ref is missing, so checking first is nicer.
    try {
      const currentSha = await git.resolveRef({ fs, gitdir, ref: fullRef });
      console.log(`Deleting branch '${fullRef}' (was pointing to ${currentSha.slice(0, 7)})...`);
    } catch (e) {
      throw new Error(`Branch '${branchName}' not found.`);
    }

    // --- STEP 3: Delete the Ref ---
    await git.deleteRef({
      fs,
      gitdir,
      ref: fullRef
    });

    console.log(`Success! Branch '${branchName}' deleted.`);

  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
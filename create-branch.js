import fs from 'fs';
import git from 'isomorphic-git';
import path from 'path';

// Parse arguments
const repoPath = process.argv[2];
const newBranchName = process.argv[3];
const sourceBranchName = process.argv[4]; // Optional

if (!repoPath || !newBranchName) {
  console.error("Usage: node create-branch.js <repo> <new-branch-name> [source-branch]");
  process.exit(1);
}

const gitdir = path.resolve(repoPath);

async function main() {
  try {
    console.log(`Open Repo: ${gitdir}`);

    // --- STEP 1: Determine the Source SHA ---
    let sourceSha;
    let sourceRef;

    if (sourceBranchName) {
      // User specified a parent (e.g., "main" or "v1.0")
      // We accept "main" or "refs/heads/main"
      sourceRef = sourceBranchName.startsWith('refs/') 
        ? sourceBranchName 
        : `refs/heads/${sourceBranchName}`; // assume standard branch if not specific
    } else {
      // User did not specify. Use HEAD.
      sourceRef = 'HEAD';
    }

    try {
      sourceSha = await git.resolveRef({ fs, gitdir, ref: sourceRef });
      console.log(`Source (${sourceRef}): ${sourceSha.slice(0, 7)}`);
    } catch (e) {
      throw new Error(`Source branch '${sourceRef}' does not exist. Cannot branch off nothing.`);
    }

    // --- STEP 2: Create the New Branch Ref ---
    // Normalize the new name to ensure it lives in refs/heads/
    const newRef = newBranchName.startsWith('refs/heads/') 
      ? newBranchName 
      : `refs/heads/${newBranchName}`;

    // Write the ref
    // We use force: false to ensure we don't accidentally overwrite an existing branch
    try {
      await git.writeRef({
        fs,
        gitdir,
        ref: newRef,
        value: sourceSha,
        force: false 
      });
      console.log(`Success! Created branch '${newRef}' pointing to ${sourceSha.slice(0, 7)}`);
    } catch (e) {
      if (e.code === 'AlreadyExistsError') {
        console.error(`Error: Branch '${newBranchName}' already exists.`);
      } else {
        throw e;
      }
    }

  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
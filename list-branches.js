import fs from 'fs';
import git from 'isomorphic-git';
import path from 'path';

// Parse arguments
const repoPath = process.argv[2];

if (!repoPath) {
  console.error("Usage: node list-branches.js <repo>");
  process.exit(1);
}

const gitdir = path.resolve(repoPath);

async function main() {
  try {
    console.log(`Open Repo: ${gitdir}\n`);
    
    // --- STEP 1: Get list of branch names ---
    // This looks in refs/heads/ for all files
    const branches = await git.listBranches({
      fs,
      gitdir,
      remote: undefined // We only want local branches, not remote references
    });

    if (branches.length === 0) {
      console.log("No branches found (Repo might be empty).");
      return;
    }

    console.log("Available Branches:");
    console.log("-------------------");

    // --- STEP 2: Iterate and Resolve SHAs ---
    // We loop through each name and find out what Commit ID it points to.
    for (const branch of branches) {
      const sha = await git.resolveRef({
        fs,
        gitdir,
        ref: `refs/heads/${branch}`
      });

      // Check if this branch is what HEAD points to
      let isHead = false;
      try {
        const headRef = await git.resolveRef({ fs, gitdir, ref: 'HEAD', depth: 2 });
        // git.resolveRef with depth returns the Ref name (e.g. refs/heads/main) if possible
        // But simpler check: read the HEAD file directly or use currentSha logic.
        // Let's stick to a simpler visual check:
      } catch (e) {}

      // A simple formatting to look like "git branch -v"
      console.log(`* ${branch.padEnd(15)} [${sha.slice(0, 7)}]`);
    }

    console.log("\nTotal:", branches.length);

  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();
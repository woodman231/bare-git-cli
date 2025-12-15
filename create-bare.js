import fs from 'fs';
import git from 'isomorphic-git';
import path from 'path';

const repoName = process.argv[2];

if (!repoName) {
  console.error("Usage: node create-bare.js <folder-name>");
  process.exit(1);
}

// We explicitly name this 'gitdir' to avoid confusion. 
// In a bare repo, the root folder IS the git directory.
const gitdir = path.resolve(repoName);

async function createBareRepo() {
  try {
    console.log(`Initializing bare repository at: ${gitdir}`);

    // --- STEP 1: Git Init (Bare) ---
    // notice we pass 'gitdir' here, not 'dir'
    await git.init({
      fs,
      gitdir, 
      bare: true,
      defaultBranch: 'main' 
    });

    // --- STEP 2: Create a Blob ---
    // Uses writeBlob directly (Plumbing)
    const blobSha = await git.writeBlob({
      fs,
      gitdir,
      blob: new Uint8Array(Buffer.from("Hello World\n")), 
    });
    console.log(`Blob created:   ${blobSha}`);

    // --- STEP 3: Create a Tree ---
    // Uses writeTree directly (Plumbing)
    const treeSha = await git.writeTree({
      fs,
      gitdir,
      tree: [
        { mode: '100644', path: 'README.md', oid: blobSha, type: 'blob' }
      ]
    });
    console.log(`Tree created:   ${treeSha}`);

    // --- STEP 4: Create a Commit ---
    // Uses writeCommit directly (Plumbing). 
    // This creates the object but DOES NOT move HEAD (solving your previous error).
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
        message: 'Initial commit via isomorphic-git',
        tree: treeSha,
        parent: [], 
        author: author,
        committer: author
      }
    });
    console.log(`Commit created: ${commitSha}`);

    // --- STEP 5: Update Reference ---
    // Manually point the branch to the new commit.
    await git.writeRef({
      fs,
      gitdir,
      ref: 'refs/heads/main',
      value: commitSha
    });
    
    console.log("Success! Repository is ready.");

  } catch (err) {
    console.error("Error creating repository:", err);
  }
}

createBareRepo();
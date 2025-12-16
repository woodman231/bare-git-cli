import { exec } from 'child_process';
import path from 'path';

const repoPath = process.argv[2];

if (!repoPath) {
  console.error("Usage: node run-gc.js <repo>");
  process.exit(1);
}

const gitdir = path.resolve(repoPath);

console.log(`Running Garbage Collection on: ${gitdir}`);

// We use 'git gc --auto' which is the standard "gentle" optimization.
// It checks if the repo is messy enough to need cleaning before doing work.
// usage: git --git-dir=... gc --auto
exec(`git --git-dir="${gitdir}" gc --auto`, (error, stdout, stderr) => {
    if (error) {
        console.error(`Exec error: ${error}`);
        return;
    }
    if (stderr) {
        // Git often prints progress to stderr, so we log it but don't treat it as a failure
        console.log(`Git Output: ${stderr}`);
    }
    if (stdout) {
        console.log(stdout);
    }
    console.log("Garbage collection complete.");
});
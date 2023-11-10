/**
 *   This script reads the rush.json file, finds the projects in listed in the file,
 *   then attempts to find each of those projects' subspaces in the common/config/subspaces folder.
 * for each subspace, this script will try to generate a pnpm-workspace.yaml file, then store it in the common/temp/subspace/ folder.
 *
 * */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import json5 from "json5";
import { execSync } from "child_process";

async function parseSubspaces() {
  const rushJson = json5.parse(fs.readFileSync("./rush.json"));
  const subspaceJson = json5.parse(fs.readFileSync("./subspace.json"));

  if (!subspaceJson.enabled) {
    console.error("Subspaces feature not enabled.");
    return;
  }

  console.log("rush json: ", rushJson);

  const { projects } = rushJson;
  const { availableSubspaces } = subspaceJson;
  const availableSubspaceMap = new Map();
  for (const subspace of availableSubspaces) {
    availableSubspaceMap.set(subspace.subspaceName, subspace);
  }

  const projectMap = {};
  for (const project of projects) {
    projectMap[project.packageName] = project;
  }

  const subspaces = {};
  // DFS search through project and project's dependencies?
  for (const project of projects) {
    let subspace = "default";
    if (project.subspace) {
      subspace = project.subspace;
    }

    if (subspace !== "default" && !availableSubspaceMap.has(subspace)) {
      console.error(
        `The subspace ${subspace} is not defined in the subspace.json file.`
      );
      return;
    }

    if (!subspaces[subspace]) {
      // Store a list of projects per subspace
      subspaces[subspace] = [];
    }

    subspaces[subspace].push(project);

    // // Look at the project's dependencies, and note down which of the dependencies are external
    // // to this subspace
    // const packageJson = JSON.parse(
    //   fs.readFileSync(`${project.projectFolder}/package.json`)
    // );
    // for (const dependencyName of Object.keys(packageJson.dependencies || {})) {
    //   const versionSpec = packageJson.dependencies[dependencyName];
    //   if (/^workspace:/.test(versionSpec)) {
    //     // Check if this project belongs to the same subspace
    //     if (projectMap[dependencyName].subspace !== project.subspace) {
    //       // Found a dependen
    //     }
    //     subspaces[subspace].push(projectMap[dependencyName]);
    //   }
    // }
  }

  // Export the subspaces to individual pnpm-workspace.yaml files
  for (const [subspaceName, subspaceProjects] of Object.entries(subspaces)) {
    const pnpmWorkspace = {
      packages: [],
    };
    for (const project of subspaceProjects) {
      pnpmWorkspace.packages.push(
        path.relative(`common/temp/${subspaceName}`, project.projectFolder)
      );
    }
    console.log("workspace packages: ", pnpmWorkspace);

    // Clean the temp subspace folder
    fs.rmSync(`common/temp/${subspaceName}`, { recursive: true, force: true });

    // Save the yaml files
    fs.mkdirSync(`common/temp/${subspaceName}`, { recursive: true });

    // Write the pnpm workspace file
    fs.writeFileSync(
      `common/temp/${subspaceName}/pnpm-workspace.yaml`,
      yaml.dump(pnpmWorkspace)
    );

    // Copy the package json file

    // Copy .npmrc file over
    fs.copyFileSync(
      `common/config/subspaces/${subspaceName}/.npmrc`,
      `common/temp/${subspaceName}/.npmrc`
    );

    // Copy .pnpm-lock.yaml file over
    fs.copyFileSync(
      `common/config/subspaces/${subspaceName}/pnpm-lock.yaml`,
      `common/temp/${subspaceName}/pnpm-lock.yaml`
    );

    // Insert the .pnpmfile.js file
    // Generate readPackage function with this set of subspace projects
    const readPackageFunction = getReadPackageFunction(subspaceProjects);
    fs.writeFileSync(
      `common/temp/${subspaceName}/.pnpmfile.cjs`,
      readPackageFunction
    );

    // Run pnpm install
    try {
      await execSync("pnpm install", { cwd: `common/temp/${subspaceName}` });

      if (fs.existsSync(`common/temp/${subspaceName}/pnpm-lock.yaml`)) {
        // Remove the original pnpm-lock file
        fs.rmSync(`common/config/subspaces/${subspaceName}/pnpm-lock.yaml`);
        // Copy back the pnpm-lock.yaml file after it is updated
        fs.copyFileSync(
          `common/temp/${subspaceName}/pnpm-lock.yaml`,
          `common/config/subspaces/${subspaceName}/pnpm-lock.yaml`
        );
      }
    } catch (e) {
      console.error("Error pnpm installing for subspace: ", subspaceName, e);
    }
  }
}

// Accepts an array of current subspace projects
function getReadPackageFunction(currSubspaceProjects) {
  console.log("projects: ", currSubspaceProjects);
  let currSubspaceProjectsString = "[";

  for (const project of currSubspaceProjects) {
    currSubspaceProjectsString += `"${project.packageName}",`;
  }

  currSubspaceProjectsString = currSubspaceProjectsString.slice(0, -1);
  currSubspaceProjectsString += "]";

  return `
"use strict";

const currSubspaceProjects = ${currSubspaceProjectsString};

/**
 * This hook is invoked during installation before a package's dependencies
 * are selected.
 * The "packageJson" parameter is the deserialized package.json
 * contents for the package that is about to be installed.
 * The "context" parameter provides a log() function.
 * The return value is the updated object.
 */
function readPackage(packageJson, context) {
  console.log(\`==> Processing "\${packageJson.name}" from \${__filename}\`);
  for (const dependencyName of Object.keys(
    packageJson.dependencies || {}
  )) {
    const versionSpec = packageJson.dependencies[dependencyName];
    // If the current subspace projects array doesn't contain this workspace reference,
    // rewrite it to a link.
    if (
      /^workspace:/.test(versionSpec) &&
      !currSubspaceProjects.includes(dependencyName)
    ) {
      console.log(
        \`Rewriting "\${packageJson.name}" dependencies[\${dependencyName}]\`
      );
      packageJson.dependencies[
        dependencyName
      ] = \`link:../\${dependencyName}/\`;
    }
  }
  return packageJson;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
`;
}

function removeFirstAndLastLines(inputString) {
  const lines = inputString.split("\n");

  if (lines.length < 3) {
    // There are not enough lines to remove the first and last lines
    return inputString;
  }

  // Remove the first and last lines
  lines.shift(); // Remove the first line
  lines.pop(); // Remove the last line

  // Join the remaining lines back into a string
  const resultString = lines.join("\n");

  return resultString;
}

parseSubspaces();

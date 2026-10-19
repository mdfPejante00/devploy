import { defineConfig } from 'devploy';

export default defineConfig({
  "projects": {
    "studio-ui": {
      "name": "studio-ui",
      "dir": "/storage/cerpsysv2/Repositories/FORGEJO/V3/UI-studio-membership",
      "targets": {
        "production": {
          "driver": "ssh",
          "hosts": [
            {
              "host": "192.168.4.124",
              "port": 22,
              "username": "dev",
              "keyPath": "/home/cerpsysv2/Desktop/test-nodejs_key",
              "passphrase": ""
            }
          ],
          "deployPath": "/var/www/devploy/studio/client",
          "keepReleases": 3,
          "include": [
            "src",
            "static",
            "components.json",
            "ecosystem.config.cjs",
            "eslint.config.js",
            "package.json",
            "package-lock.json",
            "svelte.config.js",
            "tsconfig.json",
            "vite.config.ts",
            ".env"
          ],
          "exclude": [
            ".git",
            "node_modules",
            ".claude",
            ".qodo",
            ".vscode"
          ],
          "hooks": {
            "install": [
              "npm install"
            ],
            "build": [
              "npm run build"
            ]
          }
        }
      }
    },
    "studio-api": {
      "name": "studio-api",
      "dir": "/storage/cerpsysv2/Repositories/FORGEJO/V3/UI-studio-membership/studio-backend",
      "targets": {
        "production": {
          "driver": "ssh",
          "hosts": [
            {
              "host": "192.168.4.124",
              "port": 22,
              "username": "dev",
              "keyPath": "/home/cerpsysv2/Desktop/test-nodejs_key",
              "passphrase": ""
            }
          ],
          "deployPath": "/var/www/devploy/studio/server",
          "keepReleases": 3,
          "include": [
            "build.mjs",
            "docs",
            "ecosystem.config.cjs",
            ".env",
            "eslint.config.js",
            "final_build_verification.cjs",
            "package.json",
            "package-lock.json",
            "src",
            "tsconfig.json",
            "verify_email_format.cjs"
          ],
          "exclude": [
            ".git",
            "node_modules",
            ".claude",
            ".qodo",
            ".vscode"
          ],
          "hooks": {
            "install": [
              "npm install"
            ],
            "build": [
              "npm run build"
            ]
          }
        }
      }
    },
    "inventory-ui": {
      "name": "inventory-ui",
      "dir": "/storage/cerpsysv2/Repositories/FORGEJO/V3/UI-studio-membership/inventory/inventory-svelte-ui",
      "targets": {
        "production": {
          "driver": "ssh",
          "hosts": [
            {
              "host": "192.168.4.124",
              "port": 22,
              "username": "dev",
              "keyPath": "/home/cerpsysv2/Desktop/test-nodejs_key",
              "passphrase": ""
            }
          ],
          "deployPath": "/var/www/devploy/inventory/client",
          "keepReleases": 3,
          "include": [
            "ecosystem.config.cjs",
            ".env",
            "package.json",
            "package-lock.json",
            "src",
            "static",
            "svelte.config.js",
            "tsconfig.json",
            "vite.config.ts"
          ],
          "exclude": [
            ".git",
            "node_modules",
            ".claude",
            ".qodo",
            ".vscode"
          ],
          "hooks": {
            "install": [
              "npm install"
            ],
            "build": [
              "npm run build"
            ]
          }
        }
      }
    },
    "sample": {
      "name": "sample",
      "dir": "/storage/cerpsysv2/Projects/devploy/dist",
      "targets": {
        "production": {
          "driver": "ssh",
          "hosts": [
            {
              "host": "192.168.4.30",
              "port": 22,
              "username": "dev",
              "keyPath": "/home/cerpsysv2/Desktop/cerpsys-v3-dev_key",
              "passphrase": ""
            }
          ],
          "deployPath": "/var/www/sample",
          "keepReleases": 3,
          "include": [
            "index.js"
          ],
          "exclude": [
            ".git",
            "node_modules",
            ".claude",
            ".qodo",
            ".vscode"
          ],
          "hooks": {}
        }
      }
    }
  }
});

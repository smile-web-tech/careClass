/**
 * Metro, told to leave the Android build output alone.
 *
 * Without this the bundler crashes on start, and not reliably enough to be
 * obvious:
 *
 *   Error: ENOENT: no such file or directory, watch
 *   '.../node_modules/expo-modules-autolinking/android/.../build/classes/...'
 *
 * Every native module ships an `android/` folder, and building the app locally
 * fills each one with a Gradle `build/` directory — a few thousand files that
 * Gradle then rewrites and deletes on every compile. Metro watches them because
 * they are inside `node_modules`, and nothing has told it not to.
 *
 * With no watchman installed, Metro falls back to a watcher that walks the tree
 * and calls `fs.watch` on each directory it finds. A Gradle directory deleted
 * between the walk and the watch throws ENOENT from inside the file-system
 * callback, where there is nobody to catch it, and the process dies. So the
 * bundler starts fine on a clean checkout and dies once you have built the app
 * — which reads as "the project is broken" rather than "two tools are fighting
 * over the same folder".
 *
 * Blocking them also makes startup quicker and the watch cheaper: this machine
 * allows 125k inotify watches and the Gradle output alone is a serious fraction
 * of that.
 *
 * Nothing is lost. Gradle reads those files directly; Metro only ever bundles
 * JavaScript, and there is none in there.
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Any Gradle output under a package's `android/` folder.
 *
 * The optional middle group matters: `expo/android/build` has nothing between
 * `android` and `build`, while `expo-modules-autolinking/android/
 * expo-gradle-plugin/expo-autolinking-settings-plugin/build` has two levels —
 * and it was the second shape that crashed.
 */
const GRADLE_BUILD_OUTPUT = /(^|[\\/])node_modules[\\/].*[\\/]android[\\/](.*[\\/])?build[\\/]/;

const existing = config.resolver.blockList;

// Merged rather than assigned. Expo sets its own exclusions here and replacing
// them would be a quiet regression that only shows up in someone else's build.
config.resolver.blockList = Array.isArray(existing)
  ? [...existing, GRADLE_BUILD_OUTPUT]
  : existing
    ? [existing, GRADLE_BUILD_OUTPUT]
    : [GRADLE_BUILD_OUTPUT];

/*
  `.wasm` is an asset, and by default Metro has never heard of it.

  `expo-sqlite`'s web build is SQLite compiled to WebAssembly, and its worker
  does `import wasmModule from './wa-sqlite/wa-sqlite.wasm'`. Metro resolves an
  extension it does not know as neither source nor asset, so the whole web
  bundle fails on that one line:

    Unable to resolve module ./wa-sqlite/wa-sqlite.wasm

  Nothing is wrong with the install — the file is there, 600KB of it. Metro was
  simply never told the extension exists. This is the configuration the
  expo-sqlite documentation asks for, and it only affects web: the native builds
  use the platform's own SQLite and never reach this file.

  Pushed rather than assigned, so the default list of images, fonts and media
  survives.
*/
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;

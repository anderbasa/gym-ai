#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_URL = 'https://github.com/hasaneyldrm/exercises-dataset.git';
const TARBALL_URL = 'https://codeload.github.com/hasaneyldrm/exercises-dataset/tar.gz/refs/heads/main';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

function hasCommand(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function fetchDatasetIntoTmpDir(tmpDir) {
  if (hasCommand('git')) {
    console.log('git detectado, clonando (shallow)...');
    execSync(`git clone --depth 1 ${REPO_URL} "${tmpDir}"`, { stdio: 'inherit' });
    return;
  }

  if (!hasCommand('tar')) {
    throw new Error(
      'No se encontró "git" ni "tar" en este sistema. Instala git (https://git-scm.com/downloads) ' +
        'o descarga manualmente el repo desde https://github.com/hasaneyldrm/exercises-dataset y copia ' +
        'data/exercises.json, data/exercises.schema.json, images/ y videos/ dentro de gym-ai/data/.'
    );
  }

  console.log('git no está disponible, descargando el tarball directamente de GitHub...');
  const tarballPath = path.join(tmpDir, 'dataset.tar.gz');
  const response = await fetch(TARBALL_URL);
  if (!response.ok) {
    throw new Error(`No se pudo descargar el dataset (HTTP ${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(tarballPath, buffer);

  console.log('Extrayendo con tar...');
  execSync(`tar -xzf "${tarballPath}" -C "${tmpDir}" --strip-components=1`);
  fs.rmSync(tarballPath, { force: true });
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exercises-dataset-'));
  console.log(`Descargando el dataset en una carpeta temporal: ${tmpDir}`);

  try {
    await fetchDatasetIntoTmpDir(tmpDir);

    fs.mkdirSync(DATA_DIR, { recursive: true });

    const jsonSrc = path.join(tmpDir, 'data', 'exercises.json');
    const schemaSrc = path.join(tmpDir, 'data', 'exercises.schema.json');
    const imagesSrc = path.join(tmpDir, 'images');
    const videosSrc = path.join(tmpDir, 'videos');

    if (fs.existsSync(jsonSrc)) {
      fs.copyFileSync(jsonSrc, path.join(DATA_DIR, 'exercises.json'));
    } else {
      console.warn('Aviso: no se encontró data/exercises.json en el repo origen.');
    }

    if (fs.existsSync(schemaSrc)) {
      fs.copyFileSync(schemaSrc, path.join(DATA_DIR, 'exercises.schema.json'));
    }

    if (fs.existsSync(imagesSrc)) {
      fs.cpSync(imagesSrc, path.join(DATA_DIR, 'images'), { recursive: true });
    } else {
      console.warn('Aviso: no se encontró la carpeta images/ en el repo origen.');
    }

    if (fs.existsSync(videosSrc)) {
      fs.cpSync(videosSrc, path.join(DATA_DIR, 'videos'), { recursive: true });
    } else {
      console.warn('Aviso: no se encontró la carpeta videos/ en el repo origen.');
    }

    console.log('Dataset copiado en gym-ai/data/.');
    console.log(
      'IMPORTANTE: las imágenes/gifs son © Gym Visual (gymvisual.com). Ver NOTICE.md antes de redistribuir nada.'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

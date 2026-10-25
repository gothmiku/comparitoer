import './styles.css';

/**
 * Composition root. Later phases mount the stage, wipe divider, info bar, and
 * controls here; for now it only builds the static app shell so the build
 * pipeline has a real entry point.
 */
function mountAppShell(root: HTMLElement): void {
  root.classList.add('app');

  const header = document.createElement('header');
  header.className = 'app__header';

  const title = document.createElement('h1');
  title.className = 'app__title';
  title.textContent = 'Video Compare';

  const tagline = document.createElement('p');
  tagline.className = 'app__tagline';
  tagline.textContent = 'Two local videos. One timeline. Nothing leaves this device.';

  header.append(title, tagline);

  const main = document.createElement('main');
  main.className = 'app__main';
  main.id = 'stage-root';

  root.append(header, main);
}

const root = document.getElementById('app');

if (root === null) {
  throw new Error('Missing #app root element in index.html');
}

mountAppShell(root);

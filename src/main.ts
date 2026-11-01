import { Game } from './core/Game';
import { LoadingScreen, autoQuality, toast } from './ui/Common';

/**
 * Точка входа: экран загрузки → инициализация Rapier WASM → построение мира →
 * главное меню → игровой цикл.
 */
async function bootstrap(): Promise<void> {
  const container = document.getElementById('app') as HTMLElement;
  const loading = new LoadingScreen();
  loading.set(0.05, 'Проверка WebGL…');

  // проверка WebGL
  try {
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    if (!gl) throw new Error('WebGL недоступен');
  } catch (e) {
    loading.set(1, 'Ошибка: WebGL не поддерживается этим браузером');
    console.error(e);
    return;
  }

  const game = new Game(container);

  try {
    await game.initWorld((p, text) => loading.set(0.05 + p * 0.9, text));
  } catch (e) {
    console.error('[main] ошибка инициализации', e);
    loading.set(1, 'Ошибка загрузки физики. Проверь консоль.');
    return;
  }

  loading.done();
  const q = autoQuality();
  if (q === 'low') {
    toast('Включён режим низкого качества для твоего устройства', 3000);
  }
  game.start();
}

window.addEventListener('error', (e) => {
  console.error('[global]', e.error ?? e.message);
});

void bootstrap();

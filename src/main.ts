import '../style.css';
import { Engine } from './app/Engine';

/**
 * Entry point of the application.
 */
const engine = new Engine();

engine.bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
});

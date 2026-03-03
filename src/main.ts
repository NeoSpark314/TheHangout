import '../style.css';
import { App } from './app/App';

/**
 * Entry point of the application.
 */
const app = new App();

app.bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
});

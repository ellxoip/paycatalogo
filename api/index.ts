import app from '../server/app.js';
import { registerOutboxHandlers } from '../server/workers/index.js';

registerOutboxHandlers();

export default app;

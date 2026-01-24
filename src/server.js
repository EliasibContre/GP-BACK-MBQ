import 'dotenv/config';
import  app  from './app.js';
import { env } from './config/env.js';

const port = Number(env.PORT || 3001);
app.listen(port, () => console.log(`API running on :${port}`));
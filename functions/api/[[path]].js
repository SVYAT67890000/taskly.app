import app from '../../worker/app.js';

export async function onRequest(context) {
  return app.fetch(context.request, context.env, context);
}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { app } = require('../server');
const authMiddleware = require('../middleware/authMiddleware');
const jamRoutes = require('../routes/jams');
const authRoutes = require('../routes/auth');
const reviewRoutes = require('../routes/reviews');
const JamSession = require('../models/JamSession');

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function getRouteHandler(router, path, method = 'get') {
  const stack = router._router?.stack || router.stack;
  const layer = stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route to exist`);
  return layer.route.stack.at(-1).handle;
}

test('backend route and validation contracts', async (t) => {
  await t.test('API index lists the expected route groups', () => {
    const handler = getRouteHandler(app, '/api');
    const res = responseRecorder();
    handler({}, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.endpoints, ['/api/auth', '/api/jams', '/api/reviews', '/api/chat']);
  });

  await t.test('health check reflects actual MongoDB state', () => {
    const handler = getRouteHandler(app, '/health');
    const res = responseRecorder();
    handler({}, res);
    assert.equal(res.statusCode, mongoose.connection.readyState === 1 ? 200 : 503);
    assert.equal(res.body.database, mongoose.connection.readyState === 1 ? 'connected' : 'disconnected');
  });

  await t.test('database-backed routes fail fast when MongoDB is disconnected', () => {
    const databaseGate = app._router.stack.find((layer) =>
      layer.name === '<anonymous>' && String(layer.handle).includes('database is temporarily unavailable')
    );
    assert.ok(databaseGate, 'Expected database availability middleware');
    const res = responseRecorder();
    let continued = false;
    databaseGate.handle({}, res, () => { continued = true; });
    if (mongoose.connection.readyState === 1) {
      assert.equal(continued, true);
    } else {
      assert.equal(res.statusCode, 503);
      assert.match(res.body.error, /database is temporarily unavailable/i);
      assert.equal(continued, false);
    }
  });

  await t.test('jam discovery rejects missing coordinates before querying MongoDB', async () => {
    const handler = getRouteHandler(jamRoutes, '/', 'get');
    const res = responseRecorder();
    await handler({ query: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /latitude and longitude/i);
  });

  await t.test('jam discovery rejects coordinates outside valid bounds', async () => {
    const handler = getRouteHandler(jamRoutes, '/', 'get');
    const res = responseRecorder();
    await handler({ query: { lat: '91', lng: '0' } }, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test('jam discovery rejects a custom radius below 1 km', async () => {
    const handler = getRouteHandler(jamRoutes, '/', 'get');
    const res = responseRecorder();
    await handler({ query: { lat: '0', lng: '0', radiusKm: '0' } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /between 1 and 20100/i);
  });

  await t.test('jam discovery rejects search radii over the global search limit', async () => {
    const handler = getRouteHandler(jamRoutes, '/', 'get');
    const res = responseRecorder();
      await handler({ query: { lat: '0', lng: '0', radiusKm: '20101' } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /between 1 and 20100/i);
  });

  await t.test('map discovery can search any distance and marks sessions outside the selected radius', async () => {
    const handler = getRouteHandler(jamRoutes, '/', 'get');
    const originalAggregate = JamSession.aggregate;
    let pipeline;
    JamSession.aggregate = async (queryPipeline) => { pipeline = queryPipeline; return []; };
    try {
      const res = responseRecorder();
      await handler({ query: { lat: '28.5', lng: '77.2', radiusKm: '5', mapRadiusKm: '20100' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(pipeline[0].$geoNear.maxDistance, 20100000);
      assert.deepEqual(pipeline[1].$addFields.withinSearchRadius, { $lte: ['$distanceMeters', 5000] });
    } finally {
      JamSession.aggregate = originalAggregate;
    }
  });

  await t.test('Any distance applies the global radius to both results and map boundary', async () => {
    const handler = getRouteHandler(jamRoutes, '/', 'get');
    const originalAggregate = JamSession.aggregate;
    let pipeline;
    JamSession.aggregate = async (queryPipeline) => { pipeline = queryPipeline; return []; };
    try {
      const res = responseRecorder();
      await handler({ query: { lat: '28.5', lng: '77.2', radiusKm: '20100', mapRadiusKm: '20100' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(pipeline[0].$geoNear.maxDistance, 20100000);
      assert.deepEqual(pipeline[1].$addFields.withinSearchRadius, { $lte: ['$distanceMeters', 20100000] });
    } finally {
      JamSession.aggregate = originalAggregate;
    }
  });

  await t.test('jam creation rejects unsupported host radius choices', async () => {
    const handler = getRouteHandler(jamRoutes, '/register', 'post');
    const res = responseRecorder();
    await handler({ body: {
      title: 'Test Jam', hostTeam: 'Test Band', locationName: 'Park', lat: 28.5, lng: 77.2,
      startTime: '2099-01-01T12:00:00.000Z', endTime: '2099-01-01T14:00:00.000Z', discoveryRadiusKm: 7
    } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /5, 10, 25, or 50/i);
  });

  await t.test('jam creation accepts the expanded 50 km discovery option', async () => {
    const handler = getRouteHandler(jamRoutes, '/register', 'post');
    const originalCreate = JamSession.create;
    JamSession.create = async (jam) => jam;
    try {
      const res = responseRecorder();
      await handler({ user: { _id: new mongoose.Types.ObjectId() }, body: {
        title: 'Test Jam', hostTeam: 'Test Band', locationName: 'Park', lat: 28.5, lng: 77.2,
        startTime: '2099-01-01T12:00:00.000Z', endTime: '2099-01-01T14:00:00.000Z', discoveryRadiusKm: 50
      } }, res);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.discoveryRadiusKm, 50);
    } finally {
      JamSession.create = originalCreate;
    }
  });

  await t.test('phone sign-in rejects malformed numbers without a provider call', async () => {
    const handler = getRouteHandler(authRoutes, '/phone/send-otp', 'post');
    const res = responseRecorder();
    await handler({ body: { phone: 'not-a-phone' } }, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test('email sign-in requires an email address', async () => {
    const handler = getRouteHandler(authRoutes, '/email/send-otp', 'post');
    const res = responseRecorder();
    await handler({ body: {} }, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test('Google sign-in rejects requests without a credential', async () => {
    const handler = getRouteHandler(authRoutes, '/google', 'post');
    const res = responseRecorder();
    await handler({ body: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /verified Google account/i);
  });

  await t.test('review reads reject malformed jam IDs', async () => {
    const handler = getRouteHandler(reviewRoutes, '/:jamSessionId', 'get');
    const res = responseRecorder();
    await handler({ params: { jamSessionId: 'invalid' } }, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test('protected endpoints reject missing bearer credentials', async () => {
    const res = responseRecorder();
    await authMiddleware({ headers: {} }, res, () => assert.fail('next should not be called'));
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /token missing/i);
  });
});

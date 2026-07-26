const express        = require('express');
const authMeLogic    = require('./auth-me/index');
const authRoleLogic  = require('./auth-role/index');
const chatQueryLogic = require('./chat-query/index');
const dataQueryLogic = require('./data-query/index');

const app = express();
app.use(express.json());

// ── Adapter: wrap Express req/res into Catalyst basicIO format ──────────────
const makeIO = (req, res) => ({
  request:  { method: req.method, body: req.body, headers: req.headers },
  response: {
    _s: 200, _h: {},
    status(c)  { this._s = c; return this; },
    set(k, v)  { this._h[k] = v; return this; },
    json(d)    { res.status(this._s).set(this._h).json(d); },
    send(d)    { res.status(this._s).set(this._h).send(d); },
  }
});

// ── Routes ──────────────────────────────────────────────────────────────────

// Auth: get current user + profile from UserProfiles table
app.all('/auth-me', async (req, res) => authMeLogic({ req, res, getRemainingExecutionTime: () => 30000 }));

// Auth-role + Chat + Analytics + Networks + Profiler + Forecast + Dashboard (via Catalyst SDK)
app.all('/auth-role', async (req, res) => authRoleLogic({ req, res, getRemainingExecutionTime: () => 30000 }));

// Chat via auth-role (alias — Chat.jsx calls /chat-query)
app.all('/chat-query', async (req, res) => chatQueryLogic({ req, res, getRemainingExecutionTime: () => 30000 }, makeIO(req, res)));

// Direct Data Store via OAuth (used by: Analytics, Network, Profiler, Forecast, DashboardHome)
app.all('/data-query', async (req, res) => dataQueryLogic({ req, res, getRemainingExecutionTime: () => 30000 }, makeIO(req, res)));

module.exports = app;

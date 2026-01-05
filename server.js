// 'use strict';

// if (process.env.NODE_ENV !== 'production') {
//   require('dotenv').config();
// }

// const express = require("express");
// const app = express();

// const mediasocket = require('./websocket/mediasocket');

// app.use(express.urlencoded({ extended: false }));
// app.use(express.json());

// // Logging middleware
// app.use((req, res, next) => {
//   console.log("Incoming Request:", req.method, req.url);
//   next();
// });

// // Routes
// // app.use("/", mediasocket);

// // Start server
// const port = process.env.PORT || 8080;
// const server = app.listen(port, "0.0.0.0", () => {
//   console.log(`Server listening on port ${port}`);
// });
// mediasocket(server);

'use strict';

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require("express");
const http = require("http");

const app = express();
const mediasocket = require('./websocket/mediasocket');

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log("Incoming Request:", req.method, req.url);
  next();
});

// ✅ Health check route
app.get("/", (req, res) => {
  res.status(200).send("OK - Twilio streaming server running");
});

// Create HTTP server explicitly
const server = http.createServer(app);

// Attach WebSocket server
mediasocket(server);

// Start server
const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on port ${port}`);
});


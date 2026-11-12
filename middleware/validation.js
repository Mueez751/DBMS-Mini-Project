const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const IATA_AIRPORT_REGEX = /^[A-Z]{3}$/;
const IATA_AIRLINE_REGEX = /^[A-Z0-9]{2}$/;
const VALID_CABINS = ['economy', 'premium_economy', 'business', 'first'];
const VALID_ROLES = ['customer', 'admin'];

function validateRegister(req, res, next) {
  const { email, password, role } = req.body;
  const errors = [];

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    errors.push('A valid email address is required (e.g. user@example.com).');
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }

  if (role && !VALID_ROLES.includes(role)) {
    errors.push(`Role must be one of: ${VALID_ROLES.join(', ')}.`);
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Registration validation failed',
      details: errors,
    });
  }
  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body;
  const errors = [];

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    errors.push('Please enter a valid email address.');
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    errors.push('Password is required.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Login validation failed',
      details: errors,
    });
  }
  next();
}

function validateWatchlist(req, res, next) {
  const { route_id, target_price, cabin_class } = req.body;
  const errors = [];

  const routeIdNum = parseInt(route_id, 10);
  if (isNaN(routeIdNum) || routeIdNum <= 0) {
    errors.push('route_id must be a positive integer.');
  }

  const priceNum = parseFloat(target_price);
  if (isNaN(priceNum) || priceNum <= 0 || priceNum > 100000) {
    errors.push('target_price must be a positive number greater than 0.');
  }

  if (!cabin_class || !VALID_CABINS.includes(cabin_class)) {
    errors.push(`cabin_class must be one of: ${VALID_CABINS.join(', ')}.`);
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Watchlist validation failed',
      details: errors,
    });
  }
  next();
}

function validatePriceUpdate(req, res, next) {
  const { target_price } = req.body;
  const errors = [];

  const priceNum = parseFloat(target_price);
  if (isNaN(priceNum) || priceNum <= 0 || priceNum > 100000) {
    errors.push('target_price must be a positive number greater than 0.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Price update validation failed',
      details: errors,
    });
  }
  next();
}

function validateSnapshot(req, res, next) {
  const { route_id, airline_iata, cabin_class, price, flight_date, mongo_doc_id } = req.body;
  const errors = [];

  const routeIdNum = parseInt(route_id, 10);
  if (isNaN(routeIdNum) || routeIdNum <= 0) {
    errors.push('route_id must be a positive integer.');
  }

  if (!airline_iata || !IATA_AIRLINE_REGEX.test(airline_iata)) {
    errors.push('airline_iata must be a 2-character code (e.g. EK, BA, AI).');
  }

  if (!cabin_class || !VALID_CABINS.includes(cabin_class)) {
    errors.push(`cabin_class must be one of: ${VALID_CABINS.join(', ')}.`);
  }

  const priceNum = parseFloat(price);
  if (isNaN(priceNum) || priceNum <= 0) {
    errors.push('price must be a positive number greater than 0.');
  }

  if (!flight_date || isNaN(Date.parse(flight_date))) {
    errors.push('flight_date must be a valid date (YYYY-MM-DD).');
  }

  if (mongo_doc_id && !/^[0-9a-fA-F]{24}$/.test(mongo_doc_id)) {
    errors.push('mongo_doc_id must be a valid 24-character hexadecimal ObjectId.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Fare snapshot validation failed',
      details: errors,
    });
  }
  next();
}

module.exports = {
  validateRegister,
  validateLogin,
  validateWatchlist,
  validatePriceUpdate,
  validateSnapshot,
};


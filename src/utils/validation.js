const { validationResult } = require('express-validator');
const { HttpError } = require('./httpError');

const validate = (req, _res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', errors.array());
  }
  next();
};

module.exports = { validate };

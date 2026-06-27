const notFoundHandler = (req, _res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

const errorHandler = (error, _req, res, _next) => {
  const status = error.status || 500;
  const response = {
    message: status === 500 ? 'Internal server error' : error.message
  };

  if (error.details) {
    response.details = error.details;
  }

  if (process.env.NODE_ENV !== 'production' && status === 500) {
    response.error = error.message;
  }

  res.status(status).json(response);
};

module.exports = { notFoundHandler, errorHandler };

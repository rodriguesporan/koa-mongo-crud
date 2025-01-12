const MongoClient = require('mongodb').MongoClient;

module.exports = (config, logger, callback) => {
  MongoClient.connect(config.uri, config.options)
    .then((connection) => {

      logger.info('Database connection established');

      if (typeof callback === 'function') {
        callback(connection);
      }

    })
    .catch((err) => logger.error(err))
};

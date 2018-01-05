
const ValidationException = require('./validation-exception');
const hal = require('hal');
const queryString = require('query-string');
const mongo = require('mongodb');
const MongoQF = require('./mongodb-query-filter');
const qf = new MongoQF({
  custom: {
    between: 'updatedAt',
    after: 'updatedAt',
    before: 'updatedAt'
  },
  blacklist: {fields: 1, page: 1, sort: 1, order: 1}
});
const ajv = require('ajv')({
  removeAdditional: true,
  allErrors: true
});

class CrudMapper {

  constructor(collection, collectionName, detailRoute, listRoute, schema) {
    this.collection = collection;
    this.collectionName = collectionName;
    this.detailRoute = detailRoute;
    this.listRoute = listRoute;
    this.schema = schema;
    this.pageSize = 25;
  }

  async list(params, withCount = false) {
    const query = qf.parse(params);

    params.fields = params.fields || '';
    const fields = params.fields.split(',');
    let project = {};
    fields.forEach((field) => {
      if (field.length > 0) {
        project[field] = 1;
      }
    });
    const page = parseInt(params.page || 1);
    const skip = (page - 1) * this.pageSize;

    const list = await this.collection
      .find(query)
      .project(project)
      .limit(this.pageSize)
      .skip(skip)
      .sort({createdAt: -1})
      .toArray();

    let result = {
      result: list,
      page: page,
    };

    if (withCount === true) {
      const count = await this.collection
        .find(query)
        .count();
      result['count'] = count;
      result['page_count'] = Math.ceil(count / list.length);
    }

    return result;
  }

  async detail(id, withDeleted = false) {

    let filter = { _id: new mongo.ObjectID(id) };

    if (withDeleted === false) {
      filter.deleted = { $ne: true };
    }

    return await this.collection.findOne(filter);
  }

  async create(post) {
    post = this.validateAll(post);
    let data = this.toDatabase(post);
    data.createdAt = new Date();
    data.updatedAt = data.createdAt;
    await this.collection.insertOne(data);
    return data;
  }

  async update(id, post, withDeleted = false) {

    let filter = { _id: new mongo.ObjectID(id) };

    if (withDeleted === false) {
      filter.deleted = { $ne: true };
    }

    let entity = await this.collection.findOne(filter);

    if (entity === null) {
      return null;
    }

    post = this.validate(post);
    let data = this.toDatabase(post);
    data.updatedAt = new Date();
    entity = Object.assign(entity, data);
    await this.collection.updateOne({ _id: new mongo.ObjectID(id) }, { $set: data }, { upsert: false });
    return entity;
  }

  async delete(id, userId = null) {
    let entity = await this.collection
      .findOne({ _id: new mongo.ObjectID(id), deleted: { $ne: true } });

    if (entity === null) {
      return null;
    }

    let data = {
      deleted: true,
      deletedAt: new Date()
    };
    if (userId !== null) {
      data.deletedBy = userId;
    }
    entity = Object.assign(entity, data);
    await this.collection.updateOne({ _id: new mongo.ObjectID(id) }, { $set: data }, { upsert: false });
    return entity;
  }

  async remove(id) {

    let filter = { _id: new mongo.ObjectID(id) };

    let entity = await this.collection.findOne(filter);

    if (entity === null) {
      return null;
    }

    await this.collection.deleteOne({ _id: new mongo.ObjectID(id) });
  }

  toJson(data) {
    let json = Object.assign({ id: data._id }, data);
    delete json._id;
    if (json.deleted === false) {
      delete json.deleted;
      delete json.deletedAt;
      delete json.deletedBy;
    }
    return json;
  }

  toHal(result, router) {
    let json = this.toJson(result);
    if (result.deleted === true) {
      if (result.deletedAt) {
        json.deletedAt = result.deletedAt;
      }
      if (result.deletedBy) {
        json.deletedBy = result.deletedBy;
      }
    }
    let id = result._id || result.id;
    if (typeof id === 'object') {
      id = id.toString();
    }
    return new hal.Resource(json, router.url(this.detailRoute, id));
  }

  toHalCollection(result, ctx) {

    let entities = [];

    for (let i=0; i<result.result.length; i++) {
      entities.push(this.toHal(result.result[i], ctx.router));
    }

    let query = ctx.request.query;

    let collectionUrl = ctx.router.url(this.listRoute);
    if (queryString.stringify(query).length > 0) {
      collectionUrl += '?' + queryString.stringify(query);
    }

    let paginationData = {
      _page: result.page,
      _count: entities.length
    };

    if (result.hasOwnProperty('count')) {
      paginationData['_total_items'] = result.count || 0;
    }
    if (result.hasOwnProperty('page_count')) {
      paginationData['_page_count'] = result.page_count || 1;
    }

    let collection = new hal.Resource(paginationData, collectionUrl);

    if (result.page > 2) {
      query.page = 1;
      collection.link('first', ctx.router.url(this.listRoute) + '?' + queryString.stringify(query));
    }
    if (result.page > 1) {
      query.page = result.page - 1;
      collection.link('prev', ctx.router.url(this.listRoute) +'?'+ queryString.stringify(query));
    }

    query.page = result.page + 1;
    collection.link('next', ctx.router.url(this.listRoute) + '?' + queryString.stringify(query));

    if (result.hasOwnProperty('page_count') && result.page < result.page_count - 1) {
      query.page = result.page_count;
      collection.link('last', ctx.router.url(this.listRoute) +'?'+ queryString.stringify(query));
    }

    collection.embed(this.collectionName, entities, false);
    return collection;
  }

  toDatabase(entity) {
    let data = entity;
    if (data.id) {
      data._id = data.id;
    }
    delete data.id;
    return data;
  }

  validate(data, validateAll = false) {

    let schema = this.schema;
    if (validateAll === false) {
      delete schema.required;
    }

    let valid = ajv.validate(schema, data);

    if (!valid) {
      throw new ValidationException(ajv.errors);
    }

    return data;
  }

  validateAll(data) {
    return this.validate(data, true)
  }
}

module.exports = CrudMapper;
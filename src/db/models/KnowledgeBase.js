import mongoose from 'mongoose';
import Random from 'meteor-random';

const KnowledgeBaseArticlesSchema = mongoose.Schema({
  _id: {
    type: String,
    unique: true,
    default: () => Random.id(),
  },
  title: String,
  summary: String,
  content: String,
  createdBy: String,
  createdDate: Date,
  modifiedBy: String,
  modifiedDate: Date,
  status: String,
});

const KnowledgeBaseCategoriesSchema = mongoose.Schema({
  _id: {
    type: String,
    unique: true,
    default: () => Random.id(),
  },
  title: String,
  description: String,
  articleIds: {
    type: [String],
    required: false,
  },
  icon: String,
});

const KnowledgeBaseTopicsSchema = mongoose.Schema({
  _id: {
    type: String,
    unique: true,
    default: () => Random.id(),
  },
  title: String,
  brandId: String,
  description: String,
  categoryIds: {
    type: [String],
    required: false,
  },
  loadType: String,
});

export const KnowledgeBaseArticles = mongoose.model(
  'knowledgebase_articles',
  KnowledgeBaseArticlesSchema,
);
export const KnowledgeBaseCategories = mongoose.model(
  'knowledgebase_categories',
  KnowledgeBaseCategoriesSchema,
);
export const KnowledgeBaseTopics = mongoose.model(
  'knowledgebase_topics',
  KnowledgeBaseTopicsSchema,
);

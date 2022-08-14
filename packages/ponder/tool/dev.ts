import debounce from "froebel/debounce";
import { GraphQLSchema } from "graphql";
import type { WatchListener } from "node:fs";
import { watch } from "node:fs";

import type { DbSchema } from "./buildDbSchema";
import { buildDbSchema } from "./buildDbSchema";
import { buildGqlSchema } from "./buildGqlSchema";
import { buildHandlerContext, HandlerContext } from "./buildHandlerContext";
import {
  handleHydrateCache,
  testUserConfigChanged,
  testUserSchemaChanged,
} from "./cache";
import { toolConfig } from "./config";
import { getInitialLogs } from "./fetchLogs";
import { migrateDb } from "./migrateDb";
import { processLogs } from "./processLogs";
import type { PonderConfig, PonderUserConfig } from "./readUserConfig";
import { readUserConfig } from "./readUserConfig";
import { readUserSchema } from "./readUserSchema";
import { restartServer } from "./server";
import {
  generateContractTypes,
  generateEntityTypes,
  generateHandlerTypes,
  generateSchema,
} from "./typegen";
import { generateContextType } from "./typegen/generateContextType";

// dependency graph:

// 	handlers
// 		processLogs (1 / 2)

// 	config.ponder.js
// 		generateContractTypes
// 		generateContextType (1 / 2)
// 		buildHandlerContext (1 / 2)
// 			processLogs

// 	schema.graphql
// 		buildGqlSchema
// 			generateSchema
// 			generateEntityTypes
// 			startServer
// 		buildDbSchema
// 			migrateDb
// 			generateContextType (2 / 2)
// 			buildHandlerContext (2 / 2)

const { pathToUserConfigFile, pathToUserSchemaFile } = toolConfig;

type PonderState = {
  config?: PonderConfig;
  userSchema?: GraphQLSchema;
  gqlSchema?: GraphQLSchema;
  dbSchema?: DbSchema;
  handlerContext?: HandlerContext;
  // entityNames?: string[] ?????? maybe for caching handlerContext
};

const state: PonderState = {};

const handleUserConfigFileChanged = async () => {
  const config = await readUserConfig();
  handleConfigChanged(config);
};

const handleUserSchemaFileChanged = async () => {
  const userSchema = await readUserSchema();
  handleUserSchemaChanged(userSchema);
};

const handleConfigChanged = async (newConfig: PonderConfig) => {
  // const oldConfig = state.config;
  state.config = newConfig;

  generateContractTypes(newConfig);
  generateHandlerTypes(newConfig);

  if (state.dbSchema) {
    generateContextType(newConfig, state.dbSchema);

    const handlerContext = buildHandlerContext(newConfig, state.dbSchema);
    handleHandlerContextChanged(handlerContext);
  }
};

const handleUserSchemaChanged = async (newUserSchema: GraphQLSchema) => {
  // const oldUserSchema = state.userSchema;
  state.userSchema = newUserSchema;

  const gqlSchema = buildGqlSchema(newUserSchema);
  handleGqlSchemaChanged(gqlSchema);

  const dbSchema = buildDbSchema(newUserSchema);
  handleDbSchemaChanged(dbSchema);
};

const handleGqlSchemaChanged = async (newGqlSchema: GraphQLSchema) => {
  // const oldGqlSchema = state.gqlSchema;
  state.gqlSchema = newGqlSchema;

  generateSchema(newGqlSchema);
  generateEntityTypes(newGqlSchema);

  restartServer(newGqlSchema);

  state.gqlSchema = newGqlSchema;
};

const handleDbSchemaChanged = async (newDbSchema: DbSchema) => {
  // const oldDbSchema = state.dbSchema;
  state.dbSchema = newDbSchema;

  await migrateDb(newDbSchema);

  // if (state.config) {
  //   await generateContextType(state.config, newDbSchema);
  //   console.log(`Regenerated context type`);

  //   const handlerContext = buildHandlerContext(state.config, newDbSchema);
  //   handleHandlerContextChanged(handlerContext);
  // }
};

const handleHandlerContextChanged = async (
  newHandlerContext: HandlerContext
) => {
  // const oldHandlerContext = state.handlerContext;
  state.handlerContext = newHandlerContext;

  // TODO: ...reindex the entire goddamn set of events?
  // TODO: ...re-register the handler functions and run them through the entire
  // set of events?
};

const dev = async () => {
  console.log("in dev");
  await handleHydrateCache();

  handleUserConfigFileChanged();
  handleUserSchemaFileChanged();

  // testUserConfigChanged();
  // testUserSchemaChanged();

  const userConfigListener = debounce<WatchListener<string>>(
    async (event, fileName) => {
      const isChanged = await testUserConfigChanged();
      if (isChanged) {
        console.log(`Detected ${event} in ${fileName}, reindexing...`);
        handleUserConfigFileChanged();
      }
    },
    300
  );

  const schemaListener = debounce<WatchListener<string>>(
    async (event, fileName) => {
      const isChanged = await testUserSchemaChanged();
      if (isChanged) {
        console.log(`Detected ${event} in ${fileName}, reindexing...`);
        handleUserSchemaFileChanged();
      }
    },
    300
  );

  watch(pathToUserConfigFile, userConfigListener);
  watch(pathToUserSchemaFile, schemaListener);

  // const tableCount = await migrateDb(dbSchema);
  // console.log(`Created ${tableCount} tables`);

  // const initialLogsResult = await getInitialLogs(config);
  // console.log(`Fetched ${initialLogsResult.length} logs`);

  // const handlerContext = buildHandlerContext(config, dbSchema);

  // await processLogs(initialLogsResult, handlerContext);
};

dev().catch(console.error);

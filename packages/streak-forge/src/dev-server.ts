import startServer, { doBeforeServerStart } from "@src/server";

await doBeforeServerStart();

await startServer();

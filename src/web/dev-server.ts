import { createMarketplaceWebServer } from "./server";
import { createMarketplaceWebFixture } from "./dev-fixture";

const requestedPort = Number(process.env.PORT ?? "3000");
const port = Number.isFinite(requestedPort) && requestedPort >= 0 ? Math.trunc(requestedPort) : 3000;
const fixture = await createMarketplaceWebFixture();
const server = await createMarketplaceWebServer(fixture.catalog, fixture.publishing, fixture.authorizer, port);
console.log(`Tosh Marketplace web fixture listening at ${server.url}`);

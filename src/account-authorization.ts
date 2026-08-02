import type { ID, Publisher } from "./domain";
import type { MarketplaceAuthorizer, MarketplaceAuthorizationDecision } from "./http";
import type { MarketplaceStore } from "./storage";

export interface ToshAccountIdentity {
  accountID: ID;
  publisherID: ID;
}

export interface ToshAccountService {
  authenticateBearerToken(token: string): Promise<ToshAccountIdentity | undefined>;
}

export interface ToshAccountIdentityProvider {
  authenticate(request: Request): Promise<ToshAccountIdentity | undefined>;
}

export class ToshBearerIdentityProvider implements ToshAccountIdentityProvider {
  public constructor(private readonly accountService: ToshAccountService) {}

  public authenticate(request: Request): Promise<ToshAccountIdentity | undefined> {
    const header = request.headers.get("authorization");
    const match = header?.match(/^Bearer ([^\s]+)$/);
    return match ? this.accountService.authenticateBearerToken(match[1]!) : Promise.resolve(undefined);
  }
}

export class ToshMarketplaceAuthorizer implements MarketplaceAuthorizer {
  public constructor(private readonly identityProvider: ToshAccountIdentityProvider, private readonly store: MarketplaceStore) {}

  public async authorize(request: Request, publisherID: string): Promise<MarketplaceAuthorizationDecision> {
    const identity = await this.identityProvider.authenticate(request);
    if (!identity) return { authorized: false, status: 401, message: "Publisher authorization is required." };
    if (identity.publisherID !== publisherID) return { authorized: false, status: 403, message: "The authenticated account cannot act for this publisher." };
    const publisher = await this.store.getPublisher(identity.publisherID);
    if (!publisher || !this.isActivePublisher(publisher)) return { authorized: false, status: 403, message: "The publisher account is not authorized." };
    return { authorized: true, actorID: identity.accountID, publisherID: identity.publisherID };
  }

  private isActivePublisher(publisher: Pick<Publisher, "status">): boolean {
    return publisher.status === "active";
  }
}

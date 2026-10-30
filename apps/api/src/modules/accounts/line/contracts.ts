import type { CustomerScope } from "../../../platform/scope.js";

export interface LineModule {
  signIn(idToken: string): Promise<{ customToken: string; authUserId: string }>;
  link(scope: CustomerScope, idToken: string): Promise<{ linked: true }>;
  status(scope: CustomerScope): Promise<{ linked: boolean }>;
}

export interface LineRepository {
  findLinkedAccount(
    lineUserId: string,
  ): Promise<{ authUserId: string } | undefined>;
  link(scope: CustomerScope, lineUserId: string): Promise<void>;
  status(scope: CustomerScope): Promise<boolean>;
}

export interface LineTokenVerifier {
  verify(idToken: string): Promise<{ sub: string }>;
}
export interface FirebaseCustomTokenIssuer {
  createCustomToken(uid: string): Promise<string>;
}

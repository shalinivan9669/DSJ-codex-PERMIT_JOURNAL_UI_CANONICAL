import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { allowsLegacyRequest } from "../../../../../product-policy/legacy";

@Injectable()
export class ProductBoundaryGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (!allowsLegacyRequest("api", request.method, request.originalUrl ?? request.url,
      request.headers["next-action"] !== undefined)) throw new NotFoundException();
    return true;
  }
}

import type { FactoryProvider, InjectionToken } from '@nestjs/common';

type Tokens<Deps extends unknown[]> = { [Index in keyof Deps]: InjectionToken };

/**
 * Registers a framework-free use case with Nest: the class itself is the DI
 * token and its constructor arguments are resolved from `inject`, in order.
 */
export function useCaseProvider<Deps extends unknown[], UseCase>(
  useCase: new (...deps: Deps) => UseCase,
  inject: Tokens<Deps>,
): FactoryProvider<UseCase> {
  return {
    provide: useCase,
    useFactory: (...deps: Deps) => new useCase(...deps),
    inject,
  };
}

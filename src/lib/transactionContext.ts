import { AsyncLocalStorage } from 'async_hooks';

type TxStore = {
  txDb: ReturnType<any> | null;
  client: any | null;
};

export const transactionContext = new AsyncLocalStorage<TxStore>();

export function getTransactionContext() {
  return transactionContext.getStore();
}

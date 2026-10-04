type State = {
  revision: number;
  status?: string;
  requestStatus?: string;
  approval?: {
    proposalId: string;
    status: string;
    proposalHash?: string;
  } | null;
};

export function approvalRefreshRequired(current: State, latest: State) {
  return (
    current.revision !== latest.revision ||
    (!!latest.requestStatus && current.status !== latest.requestStatus) ||
    current.approval?.proposalId !== latest.approval?.proposalId ||
    current.approval?.status !== latest.approval?.status ||
    current.approval?.proposalHash !== latest.approval?.proposalHash
  );
}

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';

/** The editor's confirmed revision, never a fresh read of a different tab's draft. */
const Evidence = createContext<number | null>(null);
const Report = createContext<Dispatch<SetStateAction<number | null>> | null>(null);
export function ProjectSaveEvidence({ children }: { readonly children: ReactNode }) {
  const [revision, setRevision] = useState<number | null>(null);
  return (
    <Report.Provider value={setRevision}>
      <Evidence.Provider value={revision}>{children}</Evidence.Provider>
    </Report.Provider>
  );
}
export function useConfirmedProjectRevision() {
  return useContext(Evidence);
}
export function useReportProjectSaveEvidence(revision: number | null, saved: boolean) {
  const report = useContext(Report);
  useLayoutEffect(() => {
    report?.(saved ? revision : null);
    return () => report?.(null);
  }, [report, revision, saved]);
}

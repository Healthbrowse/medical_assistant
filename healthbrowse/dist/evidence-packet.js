// A packet belongs to one live question. Never persist it in chat history or browser storage.
export function evidencePacket(value){
 if(!value||!Array.isArray(value.query_decomposition)||!Array.isArray(value.retrieved_sources)||!Array.isArray(value.evidence_gaps))return null;
 const {query_decomposition,retrieved_sources,evidence_gaps}=value;
 return {query_decomposition,retrieved_sources,evidence_gaps};
}

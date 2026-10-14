// Loads (or refreshes) the AIHW MyHospitals hospital directory used to match
// advertised facility names. Usage: npm run import-facilities
import { ensureFacilityDirectory } from '../src/server/maintenance';

const result = await ensureFacilityDirectory(true);
console.log(
  `${result?.added ?? 0} hospitals added, ${result?.linked ?? 0} linked to existing facilities. Source: AIHW MyHospitals API (CC BY); towns are derived from names.`,
);
process.exit(0);

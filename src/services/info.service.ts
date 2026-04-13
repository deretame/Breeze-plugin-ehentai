import type { InfoContract } from "../domain/contracts";
import { mapInfo } from "../mappers/info.mapper";

export function getInfoService(): InfoContract {
  return mapInfo();
}

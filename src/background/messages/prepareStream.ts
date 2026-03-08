import type { PlasmoMessaging } from '@plasmohq/messaging';

import { hasDomainPermission } from '~hooks/usePermission';
import type { BaseRequest } from '~types/request';
import type { BaseResponse } from '~types/response';
import { setDynamicRules } from '~utils/declarativeNetRequest';
import { openSourcePermissionTab } from '~utils/permissionTracker';
import { assertDomainWhitelist, modifiableResponseHeaders } from '~utils/storage';

interface Request extends BaseRequest {
  ruleId: number;
  targetDomains?: [string, ...string[]];
  targetRegex?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

const handler: PlasmoMessaging.MessageHandler<Request, BaseResponse> = async (req, res) => {
  try {
    if (!req.sender?.tab?.url) throw new Error('No tab URL found in the request.');
    if (!req.body) throw new Error('No request body found in the request.');

    // restrict what response headers can be modified
    req.body.responseHeaders = Object.keys(req.body.responseHeaders ?? {})
      .filter((key) => modifiableResponseHeaders.includes(key.toLowerCase()))
      .reduce(
        (obj, key) => {
          obj[key] = (req.body?.responseHeaders ?? {})[key];
          return obj;
        },
        {} as Record<string, string>,
      );

    await assertDomainWhitelist(req.sender.tab.url);

    // For prepareStream, DNR rules MUST be able to modify headers on the target
    // domains (video CDN / source domains).  Without host permissions for those
    // domains, the rules are added but never applied, which breaks playback.
    // Check each target domain and prompt the user for any that are missing.
    const missingDomains: string[] = [];
    for (const domain of req.body.targetDomains ?? []) {
      if (!(await hasDomainPermission(domain))) {
        missingDomains.push(domain);
      }
    }

    if (missingDomains.length > 0) {
      // Open permission tabs for each missing domain (rate-limited per domain).
      await Promise.all(missingDomains.map(openSourcePermissionTab));
      res.send({
        success: false,
        error: `Permission required for source domain(s): ${missingDomains.join(', ')}. Please approve in the new tab(s) and retry.`,
      });
      return;
    }

    await setDynamicRules(req.body);
    res.send({
      success: true,
    });
  } catch (err) {
    res.send({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export default handler;

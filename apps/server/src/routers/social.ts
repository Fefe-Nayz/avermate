import { socialEligibilityRouter } from "./social/eligibility";
import { socialGrantsRouter, socialProfileRouter } from "./social/profile";
import { socialGuardianRouter } from "./social/guardian";
import { socialFriendsRouter } from "./social/friends";
import { socialFriendInvitationsRouter } from "./social/friend-invitations";
import { socialBlocksRouter, socialCirclesRouter } from "./social/circles-blocks";
import { socialGroupMembersRouter, socialGroupsCoreRouter } from "./social/groups-core";
import { socialGroupInvitationsRouter } from "./social/group-invitations";
import { socialGroupPolicyRouter } from "./social/group-policy";
import { socialGroupStatsRouter } from "./social/group-stats";
import {
  socialAccountRouter,
  socialNotificationsRouter,
  socialReportsRouter,
} from "./social/account";

export const socialRouter = {
  eligibility: socialEligibilityRouter,
  guardian: socialGuardianRouter,
  profile: socialProfileRouter,
  grants: socialGrantsRouter,
  friends: {
    ...socialFriendsRouter,
    invitations: socialFriendInvitationsRouter,
  },
  circles: socialCirclesRouter,
  blocks: socialBlocksRouter,
  groups: {
    ...socialGroupsCoreRouter,
    members: socialGroupMembersRouter,
    invitations: socialGroupInvitationsRouter,
    policy: socialGroupPolicyRouter,
    ...socialGroupStatsRouter,
  },
  notifications: socialNotificationsRouter,
  reports: socialReportsRouter,
  account: socialAccountRouter,
};

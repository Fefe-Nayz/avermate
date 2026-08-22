import {
  socialNotificationsRouter,
  socialReportsRouter,
} from "./social/activity";
import {
  socialBlocksRouter,
  socialFriendInvitationsRouter,
  socialFriendsRouter,
} from "./social/friends";
import {
  socialGroupInvitationsRouter,
  socialGroupsRouter,
} from "./social/groups";
import { cohortsRouter } from "./social/cohorts";
import { socialSharingRouter } from "./social/sharing";

export const socialRouter = {
  sharing: socialSharingRouter,
  friends: {
    ...socialFriendsRouter,
    invitations: socialFriendInvitationsRouter,
  },
  blocks: socialBlocksRouter,
  groups: {
    ...socialGroupsRouter,
    invitations: socialGroupInvitationsRouter,
  },
  /**
   * A group read as a comparison a member can put on their own dashboard.
   *
   * Beside the groups rather than inside them: the surface is a different one — a card,
   * not the group's screen — and the owner's switch that opens it is its own decision.
   */
  cohorts: cohortsRouter,
  notifications: socialNotificationsRouter,
  reports: socialReportsRouter,
};

import { socialNotificationsRouter, socialReportsRouter } from "./social/activity";
import {
  socialBlocksRouter,
  socialFriendInvitationsRouter,
  socialFriendsRouter,
} from "./social/friends";
import {
  socialGroupInvitationsRouter,
  socialGroupsRouter,
} from "./social/groups";
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
  notifications: socialNotificationsRouter,
  reports: socialReportsRouter,
};

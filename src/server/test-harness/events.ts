import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnCommentCreateRequest,
  OnCommentDeleteRequest,
  OnCommentReportRequest,
  OnCommentSubmitRequest,
  OnCommentUpdateRequest,
  OnModActionRequest,
  OnModMailRequest,
  OnPostCreateRequest,
  OnPostDeleteRequest,
  OnPostFlairUpdateRequest,
  OnPostReportRequest,
  OnPostSubmitRequest,
  OnPostUpdateRequest,
} from '@devvit/web/shared';
import type {
  FakeCommentRecord,
  FakePostRecord,
  FakeRedditWorld,
  FakeUserRecord,
  ModmailConversation,
} from './fake-reddit-world';

/**
 * Builds trigger payloads in the shape Devvit sends (PostV2 / CommentV2 / UserV2 /
 * SubredditV2 JSON) from FakeRedditWorld state. Note `CommentV2.author` is the
 * author's user ID (t2_...), as on the real platform.
 */
export class EventFactory {
  constructor(private readonly world: FakeRedditWorld) {}

  subreddit(name = this.world.subredditName) {
    const s = this.world.subreddit(name);
    return {
      id: s.id,
      name: s.name,
      nsfw: false,
      type: 0,
      spam: false,
      quarantined: false,
      topics: [],
      rating: 0,
      subscribersCount: 1000,
      permalink: `/r/${s.name}/`,
      title: s.name,
      description: '',
    };
  }

  user(u: FakeUserRecord | string) {
    const rec = typeof u === 'string' ? this.world.user(u) : u;
    const flair = this.world.userFlair(rec.username);
    return {
      id: rec.id,
      name: rec.username,
      isGold: false,
      snoovatarImage: '',
      url: `https://www.reddit.com/user/${rec.username}`,
      spam: false,
      banned: this.world.subreddit().bannedUsers.has(rec.username),
      karma: rec.linkKarma + rec.commentKarma,
      iconImage: '',
      description: '',
      suspended: rec.suspended,
      accountType: 0,
      flair: flair
        ? {
            userId: rec.id,
            subredditId: this.world.subreddit().id,
            text: flair.text ?? '',
            cssClass: flair.cssClass ?? '',
            templateId: flair.templateId ?? '',
            textColor: flair.textColor ?? '',
            backgroundColor: flair.backgroundColor ?? '',
            enabled: true,
          }
        : undefined,
    };
  }

  post(p: FakePostRecord) {
    return {
      id: p.id,
      title: p.title,
      selftext: p.selftext ?? '',
      nsfw: p.nsfw,
      authorId: p.authorId ?? '',
      crowdControlLevel: 0,
      numReports: p.reports.length,
      isGallery: false,
      isMeta: false,
      createdAt: p.createdAt.getTime(),
      isApproved: p.approved,
      isArchived: false,
      distinguished: 0,
      ignoreReports: p.ignoringReports,
      isSelf: !p.url,
      isVideo: false,
      isLocked: p.locked,
      isSpoiler: p.spoiler,
      subredditId: this.world.subreddit(p.subredditName).id,
      upvotes: Math.max(p.score, 0),
      downvotes: 0,
      url: p.url ?? `https://www.reddit.com/r/${p.subredditName}/comments/${p.id.slice(3)}/`,
      isSticky: p.stickied,
      linkFlair: p.flair
        ? {
            text: p.flair.text ?? '',
            cssClass: p.flair.cssClass ?? '',
            backgroundColor: p.flair.backgroundColor ?? '',
            templateId: p.flair.templateId ?? '',
            textColor: p.flair.textColor ?? '',
          }
        : undefined,
      spam: p.spam,
      deleted: p.deleted,
      languageCode: 'en',
      updatedAt: p.createdAt.getTime(),
      gildings: 0,
      score: p.score,
      numComments: this.world.commentsInPost(p.id).length,
      thumbnail: '',
      crosspostParentId: '',
      permalink: `/r/${p.subredditName}/comments/${p.id.slice(3)}/`,
      isPoll: false,
      isPromoted: false,
      isMultiMedia: false,
      type: p.url ? 'link' : 'text',
      unlisted: false,
      galleryImages: [],
      isImage: false,
      mediaUrls: [],
      isClubContent: false,
    };
  }

  comment(c: FakeCommentRecord) {
    return {
      id: c.id,
      parentId: c.parentId,
      body: c.body,
      author: c.authorId ?? '',
      numReports: c.reports.length,
      collapsedBecauseCrowdControl: false,
      spam: c.spam,
      deleted: c.deleted,
      createdAt: c.createdAt.getTime(),
      upvotes: Math.max(c.score, 0),
      downvotes: 0,
      languageCode: 'en',
      lastModifiedAt: c.createdAt.getTime(),
      gilded: false,
      score: c.score,
      permalink: `/r/${c.subredditName}/comments/${c.postId.slice(3)}/_/${c.id.slice(3)}/`,
      hasMedia: false,
      postId: c.postId,
      subredditId: this.world.subreddit(c.subredditName).id,
      elementTypes: [],
      mediaUrls: [],
    };
  }

  private requirePost(id: string): FakePostRecord {
    const p = this.world.post(id);
    if (!p) throw new Error(`EventFactory: post ${id} not seeded`);
    return p;
  }

  private requireComment(id: string): FakeCommentRecord {
    const c = this.world.comment(id);
    if (!c) throw new Error(`EventFactory: comment ${id} not seeded`);
    return c;
  }

  postSubmit(postId: string): OnPostSubmitRequest {
    const p = this.requirePost(postId);
    return {
      type: 'PostSubmit',
      post: this.post(p),
      author: this.user(p.authorName),
      subreddit: this.subreddit(p.subredditName),
    } as OnPostSubmitRequest;
  }

  postCreate(postId: string): OnPostCreateRequest {
    return { ...this.postSubmit(postId), type: 'PostCreate' } as unknown as OnPostCreateRequest;
  }

  postUpdate(postId: string): OnPostUpdateRequest {
    return { ...this.postSubmit(postId), type: 'PostUpdate' } as unknown as OnPostUpdateRequest;
  }

  postFlairUpdate(postId: string): OnPostFlairUpdateRequest {
    return {
      ...this.postSubmit(postId),
      type: 'PostFlairUpdate',
    } as unknown as OnPostFlairUpdateRequest;
  }

  postReport(postId: string, reason: string): OnPostReportRequest {
    const p = this.requirePost(postId);
    return {
      type: 'PostReport',
      post: this.post(p),
      subreddit: this.subreddit(p.subredditName),
      reason,
    } as OnPostReportRequest;
  }

  postDelete(postId: string, source = 1, reason = 1): OnPostDeleteRequest {
    const p = this.requirePost(postId);
    return {
      type: 'PostDelete',
      postId: p.id,
      author: this.user(p.authorName),
      createdAt: p.createdAt.toISOString(),
      deletedAt: new Date().toISOString(),
      source,
      reason,
      subreddit: this.subreddit(p.subredditName),
    } as unknown as OnPostDeleteRequest;
  }

  commentCreate(commentId: string): OnCommentCreateRequest {
    const c = this.requireComment(commentId);
    return {
      type: 'CommentCreate',
      comment: this.comment(c),
      author: this.user(c.authorName),
      post: this.post(this.requirePost(c.postId)),
      subreddit: this.subreddit(c.subredditName),
    } as OnCommentCreateRequest;
  }

  commentSubmit(commentId: string): OnCommentSubmitRequest {
    return {
      ...this.commentCreate(commentId),
      type: 'CommentSubmit',
    } as unknown as OnCommentSubmitRequest;
  }

  commentUpdate(commentId: string): OnCommentUpdateRequest {
    return {
      ...this.commentCreate(commentId),
      type: 'CommentUpdate',
    } as unknown as OnCommentUpdateRequest;
  }

  commentReport(commentId: string, reason: string): OnCommentReportRequest {
    const c = this.requireComment(commentId);
    return {
      type: 'CommentReport',
      comment: this.comment(c),
      subreddit: this.subreddit(c.subredditName),
      reason,
    } as OnCommentReportRequest;
  }

  commentDelete(commentId: string): OnCommentDeleteRequest {
    const c = this.requireComment(commentId);
    return {
      type: 'CommentDelete',
      commentId: c.id,
      postId: c.postId,
      author: this.user(c.authorName),
      subreddit: this.subreddit(c.subredditName),
      createdAt: c.createdAt.toISOString(),
      deletedAt: new Date().toISOString(),
      source: 1,
      reason: 1,
    } as unknown as OnCommentDeleteRequest;
  }

  modAction(opts: {
    action: string;
    moderator: string;
    targetId?: string;
    targetUser?: string;
  }): OnModActionRequest {
    const target = opts.targetId;
    const post = target?.startsWith('t3_') ? this.world.post(target) : undefined;
    const comment = target?.startsWith('t1_') ? this.world.comment(target) : undefined;
    const author = opts.targetUser ?? post?.authorName ?? comment?.authorName;
    return {
      type: 'ModAction',
      id: `ModAction_${Date.now()}`,
      action: opts.action,
      actionedAt: new Date().toISOString(),
      subreddit: this.subreddit(),
      moderator: this.user(opts.moderator),
      targetUser: author ? this.user(author) : undefined,
      targetPost: post
        ? this.post(post)
        : comment
          ? this.post(this.requirePost(comment.postId))
          : undefined,
      targetComment: comment ? this.comment(comment) : undefined,
    } as OnModActionRequest;
  }

  modMail(convo: ModmailConversation): OnModMailRequest {
    const last = convo.messages.at(-1);
    const author = last?.author ?? convo.participant ?? 'testuser';
    return {
      type: 'ModMail',
      messageAuthor: this.user(author),
      createdAt: new Date(last?.at ?? Date.now()).toISOString(),
      messageAuthorType: this.world.isModerator(author) ? 'moderator' : 'participant_user',
      conversationState: convo.state,
      conversationType: 'sr_user',
      isAutoGenerated: false,
      conversationSubreddit: this.subreddit(convo.subredditName),
      destinationSubreddit: this.subreddit(convo.subredditName),
      conversationId: convo.id,
      messageId: last?.id ?? '',
    } as unknown as OnModMailRequest;
  }

  appInstall(installer = 'testuser'): OnAppInstallRequest {
    return {
      type: 'AppInstall',
      subreddit: this.subreddit(),
      installer: this.user(installer),
    } as OnAppInstallRequest;
  }

  appUpgrade(installer = 'testuser'): OnAppUpgradeRequest {
    return {
      type: 'AppUpgrade',
      subreddit: this.subreddit(),
      installer: this.user(installer),
    } as OnAppUpgradeRequest;
  }
}

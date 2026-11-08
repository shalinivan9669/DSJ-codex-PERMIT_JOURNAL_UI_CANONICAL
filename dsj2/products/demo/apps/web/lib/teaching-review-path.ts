export function teachingReviewPath(
  context: {
    courseId: string;
    groupId: string;
    type: "ALL" | "ATTEMPT" | "SUBMISSION";
  },
  item?: { id: string; targetType: "ATTEMPT" | "SUBMISSION" },
) {
  const query = new URLSearchParams();
  if (context.courseId) query.set("courseId", context.courseId);
  if (context.groupId) query.set("groupId", context.groupId);
  const type = item?.targetType || context.type;
  if (type !== "ALL") query.set("type", type);
  if (item) query.set("reviewId", item.id);
  return `/lms/teaching${query.size ? `?${query}` : ""}`;
}
